"""
Simplified Encompass API service for loan migration tool.
Adapted from MCT-data-bridge but without DynamoDB dependencies.
Uses in-memory token caching.
"""

import os
import json
import logging
import random
import time
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar
from urllib.parse import urlencode

import httpx
import base64

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def _check_concurrency_and_throttle(response: httpx.Response, max_ratio: float = 0.20, poll_interval: float = 2.0) -> None:
    """
    Proactive concurrency metering: check response headers and wait if utilization exceeds threshold.
    
    For ISV Partners, ICE recommends staying below 20% utilization ratio.
    Formula: (Limit - Remaining) / Limit = Utilization Ratio
    
    Args:
        response: httpx Response object with concurrency headers
        max_ratio: Maximum allowed utilization ratio (default: 0.20 for ISV partners)
        poll_interval: Seconds to wait between polling checks (default: 2.0s)
    """
    limit_str = response.headers.get("X-Concurrency-Limit-Limit")
    remaining_str = response.headers.get("X-Concurrency-Limit-Remaining")
    
    if not limit_str or not remaining_str:
        return
    
    try:
        limit = int(limit_str)
        remaining = int(remaining_str)
    except (ValueError, TypeError):
        logger.warning(f"Invalid concurrency headers: Limit={limit_str}, Remaining={remaining_str}")
        return
    
    if limit <= 0:
        return
    
    utilization_ratio = (limit - remaining) / limit
    
    # Log concurrency metrics
    logger.info(
        f"[ENCOMPASS_CONCURRENCY] limit={limit} remaining={remaining} utilized={limit - remaining} "
        f"utilization={utilization_ratio:.1%} threshold={max_ratio:.1%} "
        f"exceeded={utilization_ratio > max_ratio}"
    )
    
    if utilization_ratio > max_ratio:
        logger.warning(
            f"Concurrency utilization {utilization_ratio:.1%} exceeds ISV partner threshold {max_ratio:.1%}. "
            f"Waiting for capacity to drop below {max_ratio:.1%}..."
        )
        
        # Wait until utilization drops below threshold
        # Since we can't poll without making another API call, we wait with exponential backoff
        wait_time = poll_interval
        while utilization_ratio > max_ratio:
            time.sleep(wait_time)
            logger.info(f"Waited {wait_time}s, assuming utilization has decreased")
            # Since we can't poll without making another API call, we assume it's safe after waiting
            break


def retry_on_429(max_retries: int = 3, base_delay: float = 2.0) -> Callable[[F], F]:
    """
    Fallback decorator that retries on 429 errors with exponential backoff.
    This should RARELY trigger if proactive metering is working correctly.
    
    Args:
        max_retries: Maximum retry attempts (default: 3)
        base_delay: Base delay for exponential backoff (default: 2.0s)
    """
    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[Exception] = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        last_exception = e
                        logger.error(
                            f"UNEXPECTED 429 in {func.__name__} - proactive metering should prevent this! "
                            f"Attempt {attempt + 1}/{max_retries + 1}"
                        )
                        
                        if attempt < max_retries:
                            import random
                            delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                            logger.warning(f"Retrying in {delay:.2f}s")
                            time.sleep(delay)
                        else:
                            raise
                    else:
                        raise
            
            if last_exception:
                raise last_exception
            return None
        
        return wrapper  # type: ignore[return-value]
    return decorator


# Shared token cache across all service instances
_shared_token_cache: Dict[str, Dict[str, Any]] = {}

def _load_token_cache_from_file() -> Dict[str, Dict[str, Any]]:
    """Load token cache from instances.json file."""
    try:
        instances_file = Path(__file__).parent.parent.parent / "data" / "instances.json"
        if not instances_file.exists():
            return {}
        with open(instances_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            cache = data.get("token_cache", {})
            # Filter out expired tokens
            now = time.time()
            valid_cache = {}
            for key, entry in cache.items():
                acquired_at = entry.get("acquired_at", 0)
                last_used = entry.get("last_used", 0)
                # Only keep tokens that are less than 24 hours old and used within last 14 minutes
                if now - acquired_at < 86400 and now - last_used < 840:
                    valid_cache[key] = entry
            return valid_cache
    except Exception as e:
        logger.warning(f"Failed to load token cache from file: {e}")
        return {}

def _save_token_cache_to_file(cache: Dict[str, Dict[str, Any]]) -> None:
    """Save token cache to instances.json file."""
    try:
        instances_file = Path(__file__).parent.parent.parent / "data" / "instances.json"
        if not instances_file.exists():
            return
        # Load existing file to preserve instance configs
        with open(instances_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["token_cache"] = cache
        with open(instances_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to save token cache to file: {e}")

# Load token cache on module import
_shared_token_cache = _load_token_cache_from_file()

class EncompassApiService:
    """
    Encompass API wrapper for loan migration tool.
    Simplified version without DynamoDB - uses shared in-memory token cache that persists to file.
    """

    def __init__(self) -> None:
        self.base_url = os.getenv("ENCOMPASS_API_BASE_URL", "https://api.elliemae.com/encompass")
        self._client: Optional[httpx.Client] = None
        # Use shared token cache so tokens persist across service instances and restarts
        global _shared_token_cache
        self._token_cache = _shared_token_cache

    def _client_http(self) -> httpx.Client:
        if not self._client:
            self._client = httpx.Client(timeout=60)
        return self._client

    def _get_instance_key(self, config: Dict[str, Any]) -> str:
        """Generate a unique key for instance config."""
        return f"{config.get('api_server', '')}:{config.get('instance_id', '')}:{config.get('username', '')}"

    def _normalize_instance(self, instance_id: str) -> str:
        """Normalize instance ID for Encompass API usage."""
        s = (instance_id or "").strip().upper()
        if not s:
            return s
        if s.startswith("TEBE") or s.startswith("BE"):
            return s
        if s.startswith("30"):
            return "BE" + s[2:]
        if s.isdigit():
            return "BE" + s.zfill(6)
        return s

    def _should_refresh_token(self, cache_entry: Optional[Dict[str, Any]]) -> bool:
        """Check if token needs refresh (14 min inactivity or 24hr age)."""
        if not cache_entry:
            return True
        
        now = time.time()
        last_used = cache_entry.get("last_used", 0)
        acquired_at = cache_entry.get("acquired_at", 0)
        
        # Refresh if last used more than 14 minutes ago
        if now - last_used > 840:
            return True
        
        # Refresh if token is older than 24 hours
        if now - acquired_at > 86400:
            return True
        
        return False

    def get_token(self, config: Dict[str, Any]) -> str:
        """
        Get access token for instance config.
        Uses in-memory cache with refresh logic.
        """
        instance_key = self._get_instance_key(config)
        cached = self._token_cache.get(instance_key)
        
        if not self._should_refresh_token(cached):
            token = cached["token"]
            # Update last_used
            cached["last_used"] = time.time()
            logger.info(f"Token cache HIT for instance {config.get('instance_id')}")
            # Persist updated last_used to file (but don't do it every time to avoid excessive writes)
            # Only save if last_used changed significantly (every 5 minutes)
            if time.time() - cached.get("_last_saved", 0) > 300:
                cached["_last_saved"] = time.time()
                _save_token_cache_to_file(self._token_cache)
            return token
        
        logger.info(f"Token cache MISS for instance {config.get('instance_id')}, acquiring new token")
        token = self._get_new_access_token(config)
        
        # Save to cache
        now = time.time()
        self._token_cache[instance_key] = {
            "token": token,
            "acquired_at": now,
            "last_used": now,
        }
        
        # Persist to file
        _save_token_cache_to_file(self._token_cache)
        
        return token

    def _get_new_access_token(self, config: Dict[str, Any]) -> str:
        """Get a fresh access token."""
        token_url = f"{config.get('api_server', 'https://api.elliemae.com')}/oauth2/v1/token"
        instance_id = config.get("instance_id")
        client_id = config.get("client_id")
        client_secret = config.get("client_secret")
        username = config.get("username")
        password = config.get("password")
        
        normalized_instance = self._normalize_instance(instance_id or "")
        effective_username = f"{username}@encompass:{normalized_instance}"
        
        payload = {
            "grant_type": "password",
            "username": effective_username,
            "password": password,
            "client_id": client_id,
            "scope": "lp",
        }
        if client_secret:
            payload["client_secret"] = client_secret
        
        try:
            r = self._client_http().post(
                token_url,
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            r.raise_for_status()
            data = r.json()
            return f"{data['token_type']} {data['access_token']}"
        except httpx.HTTPStatusError as e:
            logger.error(f"Token acquisition failed: {e.response.status_code} {e.response.text}")
            raise

    def _get_base_url(self, config: Dict[str, Any]) -> str:
        """Get the base URL for API calls, using config's api_server if provided."""
        api_server = config.get("api_server", "https://api.elliemae.com")
        # Remove trailing slash and add /encompass if not present
        api_server = api_server.rstrip("/")
        if not api_server.endswith("/encompass"):
            api_server = f"{api_server}/encompass"
        return api_server

    @retry_on_429(max_retries=5, base_delay=2.0)
    def query_loans(
        self,
        config: Dict[str, Any],
        fields: List[str],
        loan_folders: List[str],
        filter_obj: Optional[Dict[str, Any]] = None,
        start: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Query loans from Encompass loanPipeline API."""
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loanPipeline"
        headers = {"Authorization": token, "Content-Type": "application/json"}
        params: Dict[str, Any] = {"start": start, "limit": max(1, limit)}
        
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        payload = {
            "fields": fields,
            "loanFolders": loan_folders,
        }
        if filter_obj:
            payload["filter"] = filter_obj
        
        try:
            r = self._client_http().post(url, headers=headers, params=params, json=payload)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            
            # Check if response has content
            if not r.text or not r.text.strip():
                logger.warning("Empty response from query loans API")
                return []
            
            try:
                data = r.json()
            except Exception as json_err:
                logger.error(f"Failed to parse JSON response from query loans: {r.text[:500]}")
                raise ValueError(f"Invalid JSON response from query loans API: {json_err}")
            
            return data if isinstance(data, list) else []
        except httpx.HTTPStatusError as e:
            error_text = e.response.text if e.response.text else "No error message"
            logger.error(f"Query loans failed: {e.response.status_code} - {error_text[:500]}")
            raise ValueError(f"Query loans failed: {e.response.status_code} - {error_text[:200]}")
        except ValueError as e:
            # Re-raise ValueError as-is
            raise
        except Exception as e:
            logger.error(f"Unexpected error querying loans: {e}")
            raise ValueError(f"Unexpected error querying loans: {str(e)}")

    @retry_on_429(max_retries=5, base_delay=2.0)
    def create_loan(self, config: Dict[str, Any], loan_data: Dict[str, Any], loan_folder: Optional[str] = None) -> str:
        """Create a minimal loan in target instance. Follows pattern from migrate_loans.py."""
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        # Build URL with loanFolder as query parameter (not in JSON body)
        url = f"{base_url}/v3/loans"
        if loan_folder:
            url += f"?loanFolder={loan_folder}"
        if normalized_instance:
            separator = "&" if loan_folder else "?"
            url += f"{separator}instanceId={normalized_instance}"
        url += "&view=entity"  # Use entity view like original script
        
        headers = {"Authorization": token, "Content-Type": "application/json"}
        
        try:
            # Use data=json.dumps() like original script, not json= parameter
            import json
            r = self._client_http().post(url, headers=headers, data=json.dumps(loan_data))
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            
            # Check if response has content before parsing JSON
            if not r.text or not r.text.strip():
                raise ValueError("Empty response from create loan API")
            
            try:
                result = r.json()
            except Exception as json_err:
                logger.error(f"Failed to parse JSON response: {r.text[:500]}")
                raise ValueError(f"Invalid JSON response from create loan API: {json_err}")
            
            # Extract loan ID - handle both string and dict responses (like original script)
            loan_id = None
            if isinstance(result, str):
                loan_id = result.strip().strip('"')
            elif isinstance(result, dict):
                # Try multiple possible keys
                for key in ["id", "loanId", "loanGuid", "guid"]:
                    if key in result and result[key]:
                        loan_id = result[key]
                        break
            
            if not loan_id:
                logger.error(f"No loan ID in response: {result}")
                raise ValueError("No loan ID returned from create loan API")
            
            return loan_id
        except httpx.HTTPStatusError as e:
            error_text = e.response.text if e.response.text else "No error message"
            logger.error(f"Create loan failed: {e.response.status_code} - {error_text[:500]}")
            raise ValueError(f"Create loan failed: {e.response.status_code} - {error_text[:200]}")
        except ValueError as e:
            # Re-raise ValueError as-is
            raise
        except Exception as e:
            logger.error(f"Unexpected error creating loan: {e}")
            raise ValueError(f"Unexpected error creating loan: {str(e)}")

    @retry_on_429(max_retries=5, base_delay=2.0)
    def update_loan_fields(
        self,
        config: Dict[str, Any],
        loan_id: str,
        fields: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Update loan fields using fieldWriter API.
        Fields format: [{"id": "364", "value": "12345"}, ...]
        """
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loans/{loan_id}/fieldWriter"
        headers = {"Authorization": token, "Content-Type": "application/json"}
        params = {}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        try:
            # Log payload being sent (first 3 fields for debugging)
            if fields:
                log_fields = fields[:3]
                logger.info(f"fieldWriter payload (first {min(3, len(fields))} fields): {log_fields}")
            
            r = self._client_http().post(url, headers=headers, params=params, json=fields)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            
            # Log response even on success to check for warnings or field-level results
            try:
                response_body = r.json()
                if isinstance(response_body, dict):
                    # Check for warnings
                    if response_body.get("warnings"):
                        logger.warning(f"fieldWriter returned warnings: {response_body.get('warnings')}")
                    # Check for field-level results (some APIs return per-field success/failure)
                    if response_body.get("results") or response_body.get("fields"):
                        logger.info(f"fieldWriter response includes field-level results: {response_body.get('results') or response_body.get('fields')}")
                    # Log full response for investigation
                    logger.debug(f"fieldWriter full response: {json.dumps(response_body, indent=2)[:1000]}")
            except Exception:
                # If response is not JSON, log the text
                logger.debug(f"fieldWriter response (non-JSON): {r.text[:500] if r.text else 'empty'}")
            
            return {"success": True, "updated_fields": len(fields), "response": r.text[:500] if r.text else None}
        except httpx.HTTPStatusError as e:
            # Parse errors to see which fields failed
            errors = []
            failed_field_indices = set()
            failed_field_ids = []
            error_text = e.response.text if e.response.text else "No error message"
            
            try:
                if error_text.strip():
                    error_data = e.response.json()
                    if "errors" in error_data:
                        errors = error_data["errors"]
                        # Parse which specific fields failed
                        for err in errors:
                            summary = err.get("summary", "")
                            # Parse "contract[X].id" to get index
                            if "contract[" in summary and "].id" in summary:
                                try:
                                    idx_str = summary.split("contract[")[1].split("].id")[0]
                                    idx = int(idx_str)
                                    failed_field_indices.add(idx)
                                    if idx < len(fields):
                                        failed_field_ids.append(fields[idx].get("id", "unknown"))
                                except (ValueError, IndexError):
                                    pass
            except Exception as json_err:
                logger.warning(f"Failed to parse error JSON: {error_text[:200]}")
            
            # Calculate success count if we have partial success
            successful_count = len(fields) - len(failed_field_indices) if failed_field_indices else 0
            
            result = {
                "success": False,
                "status_code": e.response.status_code,
                "errors": errors,
                "error_text": error_text[:500],
                "failed_field_indices": list(failed_field_indices),
                "failed_field_ids": failed_field_ids,
                "successful_count": successful_count,
                "total_fields": len(fields)
            }
            
            # If some fields succeeded, mark as partial success
            if successful_count > 0:
                result["partial_success"] = True
                logger.info(f"Partial success: {successful_count}/{len(fields)} fields updated, {len(failed_field_indices)} failed")
            
            return result

    @retry_on_429(max_retries=5, base_delay=2.0)
    def update_loan(
        self,
        config: Dict[str, Any],
        loan_id: str,
        loan_data: Dict[str, Any],
        view: str = "id"
    ) -> Dict[str, Any]:
        """
        Update loan using Update Loan API (PATCH /v3/loans/{loanId}).
        This API supports nested paths and can update fields that fieldWriter cannot.
        
        Args:
            config: Instance configuration
            loan_id: Target loan GUID
            loan_data: Partial loan data to update (e.g., {"fields": {"2": "500000"}})
            view: View parameter - "id" for numeric IDs, "entity" for friendly names
        
        Returns:
            Dict with success status and response data
        """
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loans/{loan_id}"
        headers = {"Authorization": token, "Content-Type": "application/json"}
        params = {"view": view}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        try:
            r = self._client_http().patch(url, headers=headers, params=params, json=loan_data)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            
            response_data = r.json() if r.text else {}
            return {
                "success": True,
                "response": response_data,
                "status_code": r.status_code
            }
        except httpx.HTTPStatusError as e:
            error_text = e.response.text if e.response.text else "No error message"
            try:
                error_data = e.response.json()
            except Exception:
                error_data = {"error": error_text}
            
            return {
                "success": False,
                "status_code": e.response.status_code,
                "error": error_data,
                "error_text": error_text[:500]
            }

    @retry_on_429(max_retries=5, base_delay=2.0)
    def get_loan_by_id(
        self,
        config: Dict[str, Any],
        loan_id: str,
        view: str = "entity",
        fields: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get a loan by ID using Get Loan API.
        More reliable than query_loans for verification.
        
        Args:
            config: Instance configuration
            loan_id: Loan GUID
            view: View parameter (entity, id, summary)
            fields: Optional list of field IDs to retrieve (if None, gets all fields)
        
        Returns:
            Loan data dictionary or None if not found
        """
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loans/{loan_id}"
        headers = {"Authorization": token}
        params = {"view": view}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        if fields:
            # Convert field IDs to appropriate format based on view
            if view == "entity":
                # For entity view, use Fields.{id} format for numeric IDs
                formatted_fields = []
                for f in fields:
                    if str(f).isdigit():
                        formatted_fields.append(f"Fields.{f}")
                    else:
                        formatted_fields.append(str(f))
                params["fields"] = ",".join(formatted_fields)
            else:
                # For id view, use numeric IDs as-is (no Fields. prefix)
                params["fields"] = ",".join([str(f) for f in fields])
        
        # Log the request for debugging
        logger.debug(f"Get loan {loan_id} with view={view}, fields={params.get('fields', 'all')}")
        
        try:
            r = self._client_http().get(url, headers=headers, params=params)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            loan_data = r.json()
            
            # Debug: If fields parameter was used but response has no fields, try without it
            if fields and not loan_data.get("fields"):
                logger.warning(f"Loan {loan_id} response has no 'fields' with fields parameter. Retrying without fields parameter...")
                params_no_fields = {k: v for k, v in params.items() if k != "fields"}
                r2 = self._client_http().get(url, headers=headers, params=params_no_fields)
                _check_concurrency_and_throttle(r2)
                r2.raise_for_status()
                loan_data_full = r2.json()
                if loan_data_full.get("fields"):
                    logger.info(f"Got {len(loan_data_full.get('fields', {}))} fields without fields parameter")
                    # Filter to only requested fields from the full response
                    requested_fields_dict = {}
                    loan_fields_full = loan_data_full.get("fields", {})
                    
                    # Try to find each requested field in various formats
                    for field_id in fields:
                        field_id_str = str(field_id)
                        # Try multiple formats
                        if field_id_str in loan_fields_full:
                            requested_fields_dict[field_id_str] = loan_fields_full[field_id_str]
                        elif f"Fields.{field_id_str}" in loan_fields_full:
                            requested_fields_dict[f"Fields.{field_id_str}"] = loan_fields_full[f"Fields.{field_id_str}"]
                        elif view == "entity" and f"Fields.{field_id_str}" in loan_fields_full:
                            requested_fields_dict[f"Fields.{field_id_str}"] = loan_fields_full[f"Fields.{field_id_str}"]
                        elif view == "id" and field_id_str in loan_fields_full:
                            requested_fields_dict[field_id_str] = loan_fields_full[field_id_str]
                    
                    if requested_fields_dict:
                        loan_data["fields"] = requested_fields_dict
                        logger.info(f"Filtered to {len(requested_fields_dict)} requested fields from full loan response")
                        return loan_data
                    else:
                        # If we can't find requested fields, return full response anyway
                        logger.warning(f"Could not find any requested fields in loan response, returning full loan")
                        return loan_data_full
            
            return loan_data
        except httpx.HTTPStatusError as e:
            logger.warning(f"Could not get loan {loan_id} with view={view}: {e.response.status_code} {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.warning(f"Error getting loan {loan_id}: {e}")
            return None

    @retry_on_429(max_retries=5, base_delay=2.0)
    def get_loan_last_modified(self, config: Dict[str, Any], loan_id: str) -> Optional[float]:
        """
        Get last modified timestamp for a loan.
        Extracts from loan metadata (lastModified or modifiedDate fields).
        
        Returns:
            Unix timestamp as float, or None if not available
        """
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loans/{loan_id}"
        headers = {"Authorization": token}
        params = {"view": "entity"}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        try:
            r = self._client_http().get(url, headers=headers, params=params)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            loan_data = r.json()
            
            # Try different possible field names for last modified
            last_modified = (
                loan_data.get("lastModified") or
                loan_data.get("modifiedDate") or
                loan_data.get("lastModifiedDate") or
                loan_data.get("modified")
            )
            
            if last_modified:
                # If it's already a timestamp (number)
                if isinstance(last_modified, (int, float)):
                    return float(last_modified)
                # If it's a string, try to parse it
                if isinstance(last_modified, str):
                    try:
                        from datetime import datetime
                        # Try ISO format
                        dt = datetime.fromisoformat(last_modified.replace("Z", "+00:00"))
                        return dt.timestamp()
                    except Exception:
                        pass
            
            # Default to current time if not found
            return time.time()
        except httpx.HTTPStatusError as e:
            logger.warning(f"Could not get last modified for loan {loan_id}: {e.response.status_code}")
            return None
        except Exception as e:
            logger.warning(f"Error getting last modified for loan {loan_id}: {e}")
            return None

    @retry_on_429(max_retries=5, base_delay=2.0)
    def get_loan_folders(self, config: Dict[str, Any]) -> List[str]:
        """Get list of loan folders for instance."""
        token = self.get_token(config)
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loanFolders"
        headers = {"Authorization": token}
        params = {}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        try:
            r = self._client_http().get(url, headers=headers, params=params)
            _check_concurrency_and_throttle(r)
            r.raise_for_status()
            data = r.json()
            folders: List[str] = []
            if isinstance(data, list):
                for item in data:
                    name = (
                        (item.get("name") if isinstance(item, dict) else None)
                        or (item.get("folderName") if isinstance(item, dict) else None)
                        or (str(item) if item is not None else None)
                    )
                    if name:
                        folders.append(name)
            return folders
        except httpx.HTTPStatusError as e:
            logger.error(f"Get loan folders failed: {e.response.status_code} {e.response.text}")
            raise

    def get_canonical_fields(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Get canonical fields for instance."""
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        url = f"{base_url}/v3/loanPipeline/canonicalFields"
        params = {}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        logger.info(f"Getting canonical fields from: {url} with instanceId: {normalized_instance}")
        
        # Retry once if we get 401 (token might be expired)
        max_retries = 2
        for attempt in range(max_retries):
            try:
                token = self.get_token(config)
                headers = {"Authorization": token}
                logger.debug(f"Attempt {attempt + 1}: Using token: {token[:50]}...")
                
                r = self._client_http().get(url, headers=headers, params=params)
                
                # Check concurrency limits (only if not 401, since we'll retry)
                if r.status_code != 401:
                    _check_concurrency_and_throttle(r)
                
                # If 401, clear token cache and retry
                if r.status_code == 401 and attempt < max_retries - 1:
                    instance_key = self._get_instance_key(config)
                    if instance_key in self._token_cache:
                        del self._token_cache[instance_key]
                    logger.warning(f"401 Unauthorized - Token expired, refreshing and retrying (attempt {attempt + 1})")
                    logger.debug(f"Response: {r.text[:200]}")
                    continue
                
                r.raise_for_status()
                items = r.json()
                out: List[Dict[str, Any]] = []
                if isinstance(items, list):
                    for it in items:
                        cname = it.get("canonicalName") or it.get("name")
                        dname = it.get("displayName") or it.get("description") or cname
                        dtype = it.get("dataType") or it.get("fieldType")
                        # Check for numeric ID in various possible fields
                        numeric_id = it.get("id") or it.get("fieldId") or it.get("fieldID") or it.get("numericId")
                        if not cname:
                            continue
                        out.append({
                            "fieldID": cname,
                            "description": dname,
                            "dataType": dtype,
                            "numericId": numeric_id,  # Include if available
                            "raw": it  # Include full response for debugging
                        })
                return out
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401 and attempt < max_retries - 1:
                    # Clear token cache and retry
                    instance_key = self._get_instance_key(config)
                    if instance_key in self._token_cache:
                        del self._token_cache[instance_key]
                        _save_token_cache_to_file(self._token_cache)
                    logger.warning(f"401 Unauthorized - Token expired, refreshing and retrying (attempt {attempt + 1})")
                    logger.debug(f"Response: {e.response.text[:200]}")
                    continue
                logger.error(f"Get canonical fields failed: {e.response.status_code} {e.response.text[:500]}")
                logger.error(f"URL: {url}, Params: {params}, Headers: {dict(headers)}")
                raise

    @retry_on_429(max_retries=5, base_delay=2.0)
    def get_field_schema(self, config: Dict[str, Any], field_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Get field schema definitions for specified field IDs.
        Uses Get Field Schema API: /v3/schemas/loan/standardFields
        
        Args:
            config: Instance configuration
            field_ids: List of field IDs to get schemas for (e.g., ["364", "19", "4000"])
        
        Returns:
            Dictionary mapping field_id -> field_definition
            Field definition includes: fieldType, options/enum (for picklists), editable, format, etc.
        """
        if not field_ids:
            return {}
        
        normalized_instance = self._normalize_instance(config.get("instance_id", ""))
        base_url = self._get_base_url(config)
        
        # API accepts comma-separated field IDs
        ids_param = ",".join(str(fid) for fid in field_ids)
        url = f"{base_url}/v3/schemas/loan/standardFields"
        params = {"ids": ids_param, "start": 0, "limit": len(field_ids)}
        if normalized_instance:
            params["instanceId"] = normalized_instance
        
        logger.info(f"Getting field schema for {len(field_ids)} fields")
        
        # Retry once if we get 401 (token might be expired)
        max_retries = 2
        for attempt in range(max_retries):
            try:
                token = self.get_token(config)
                headers = {"Authorization": token}
                
                r = self._client_http().get(url, headers=headers, params=params)
                
                # Check concurrency limits (only if not 401, since we'll retry)
                if r.status_code != 401:
                    _check_concurrency_and_throttle(r)
                
                # If 401, clear token cache and retry
                if r.status_code == 401 and attempt < max_retries - 1:
                    instance_key = self._get_instance_key(config)
                    if instance_key in self._token_cache:
                        del self._token_cache[instance_key]
                    logger.warning(f"401 Unauthorized - Token expired, refreshing and retrying (attempt {attempt + 1})")
                    continue
                
                r.raise_for_status()
                items = r.json()
                
                # Build dictionary mapping field_id -> field_definition
                schema_dict = {}
                if isinstance(items, list):
                    for item in items:
                        # Extract field ID from various possible fields
                        field_id = (
                            item.get("id") or 
                            item.get("fieldId") or 
                            item.get("fieldID") or
                            str(item.get("numericId", ""))
                        )
                        if field_id:
                            schema_dict[str(field_id)] = item
                
                logger.debug(f"Retrieved schema for {len(schema_dict)} fields")
                return schema_dict
                
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401 and attempt < max_retries - 1:
                    # Clear token cache and retry
                    instance_key = self._get_instance_key(config)
                    if instance_key in self._token_cache:
                        del self._token_cache[instance_key]
                        _save_token_cache_to_file(self._token_cache)
                    logger.warning(f"401 Unauthorized - Token expired, refreshing and retrying (attempt {attempt + 1})")
                    continue
                logger.error(f"Get field schema failed: {e.response.status_code} {e.response.text[:500]}")
                raise
            except Exception as e:
                logger.error(f"Unexpected error getting field schema: {e}")
                raise

    def _detect_field_type(self, field_id: str, field_schema_cache: Dict[str, Dict[str, Any]]) -> Optional[str]:
        """
        Detect field type from field schema cache.
        
        Returns:
            Field type: "date", "datetime", "number", "option", "text", or None if unknown
        """
        field_schema = field_schema_cache.get(str(field_id))
        if not field_schema:
            return None
        
        field_type = field_schema.get("fieldType", "").lower()
        format_type = field_schema.get("format", "").lower()
        
        # Check for option/picklist fields
        if field_schema.get("options") or field_schema.get("enum") or field_schema.get("allowedValues"):
            return "option"
        
        # Check for date/datetime fields
        if "date" in field_type or "date" in format_type:
            if "time" in field_type or "time" in format_type or "datetime" in format_type:
                return "datetime"
            return "date"
        
        # Check for number fields
        if "number" in field_type or "numeric" in field_type or "decimal" in field_type or "integer" in field_type:
            return "number"
        
        # Default to text
        return "text"

    def _get_field_allowed_values(self, field_id: str, field_schema_cache: Dict[str, Dict[str, Any]]) -> Optional[List[str]]:
        """
        Get allowed values for option/picklist fields from schema cache.
        
        Returns:
            List of allowed values, or None if not an option field or not found
        """
        field_schema = field_schema_cache.get(str(field_id))
        if not field_schema:
            return None
        
        # Try different possible property names for allowed values
        options = field_schema.get("options") or field_schema.get("enum") or field_schema.get("allowedValues")
        if options:
            if isinstance(options, list):
                return [str(opt.get("value", opt) if isinstance(opt, dict) else opt) for opt in options]
            elif isinstance(options, dict):
                # If it's a dict, try to extract values
                return [str(v) for v in options.values() if v]
        
        return None

    def _validate_option_value(self, value: Any, allowed_values: List[str]) -> Optional[str]:
        """
        Validate option/picklist value against allowed values.
        Performs case-insensitive matching, handles spaces, and handles variations.
        
        Returns:
            Exact matched value from allowed_values, or None if invalid
        """
        if value is None:
            return None
        
        value_str = str(value).strip()
        if not value_str:
            return None
        
        # Normalize value: remove spaces for comparison (e.g., "First Lien" -> "FirstLien")
        value_normalized = value_str.replace(" ", "").replace("-", "").replace("_", "")
        
        # Try exact match first (case-sensitive)
        if value_str in allowed_values:
            return value_str
        
        # Try case-insensitive match
        value_lower = value_str.lower()
        for allowed in allowed_values:
            if str(allowed).lower() == value_lower:
                return str(allowed)  # Return the exact case from allowed_values
        
        # Try normalized match (remove spaces, dashes, underscores)
        for allowed in allowed_values:
            allowed_normalized = str(allowed).replace(" ", "").replace("-", "").replace("_", "")
            if allowed_normalized.lower() == value_normalized.lower():
                return str(allowed)  # Return the exact case from allowed_values
        
        # Try partial match (e.g., "Purchase" matches "Purchase - Primary Residence")
        for allowed in allowed_values:
            if value_lower in str(allowed).lower() or str(allowed).lower() in value_lower:
                return str(allowed)
        
        return None

    def _format_field_value(self, value: Any, field_schema: Optional[Dict[str, Any]]) -> str:
        """
        Format field value based on field type from schema.
        Per API docs:
        - Dates: yyyy-MM-dd
        - Date-times: yyyy-MM-ddTHH:mm:ssZ
        - Numbers: Keep as number but convert to string for API
        - Text: Trim whitespace
        - Options: Use exact value from allowed options
        
        Returns:
            Formatted value as string (fieldWriter API requires string values)
        """
        if value is None:
            return ""
        
        if not field_schema:
            # No schema info, just convert to string and trim
            return str(value).strip()
        
        field_type = self._detect_field_type(
            field_schema.get("id") or field_schema.get("fieldId") or "",
            {str(field_schema.get("id") or field_schema.get("fieldId") or ""): field_schema}
        )
        
        if field_type == "date":
            # Format as yyyy-MM-dd per API docs
            from datetime import datetime
            try:
                # Try parsing various date formats
                if isinstance(value, str):
                    value_str = value.strip()
                    # Try common formats - handle both zero-padded and single-digit dates
                    date_formats = [
                        "%m/%d/%Y %I:%M:%S %p",  # 02/26/2024 12:00:00 AM
                        "%#m/%#d/%Y %I:%M:%S %p", # 2/26/2024 12:00:00 AM (Windows)
                        "%-m/%-d/%Y %I:%M:%S %p", # 2/26/2024 12:00:00 AM (Unix)
                        "%m/%d/%Y %H:%M:%S",     # 02/26/2024 00:00:00
                        "%#m/%#d/%Y %H:%M:%S",   # 2/26/2024 00:00:00 (Windows)
                        "%-m/%-d/%Y %H:%M:%S",   # 2/26/2024 00:00:00 (Unix)
                        "%m/%d/%Y",              # 02/26/2024
                        "%#m/%#d/%Y",            # 2/26/2024 (Windows)
                        "%-m/%-d/%Y",            # 2/26/2024 (Unix)
                        "%Y-%m-%d",              # 2024-02-26
                        "%m-%d-%Y",              # 02-26-2024
                        "%d/%m/%Y",              # 26/02/2024
                        "%Y/%m/%d",              # 2024/02/26
                    ]
                    for fmt in date_formats:
                        try:
                            # Skip formats with # or - on non-Windows/Unix (will fail gracefully)
                            if ("%#" in fmt or "%-" in fmt) and not (hasattr(datetime, '_strptime') or True):
                                continue
                            dt = datetime.strptime(value_str, fmt)
                            formatted = dt.strftime("%Y-%m-%d")
                            return formatted
                        except (ValueError, AttributeError):
                            continue
                    
                    # If parsing fails, try manual extraction for single-digit dates
                    # Pattern: M/D/YYYY or MM/DD/YYYY (with optional time)
                    import re
                    date_match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', value_str)
                    if date_match:
                        month, day, year = date_match.groups()
                        try:
                            dt = datetime(int(year), int(month), int(day))
                            formatted = dt.strftime("%Y-%m-%d")
                            logger.debug(f"Manually parsed date '{value_str}' -> '{formatted}'")
                            return formatted
                        except ValueError:
                            pass
                    
                    # Last resort - return as-is (might already be correct or API will reject)
                    logger.warning(f"Could not format date '{value_str}', returning as-is")
                    return value_str
                elif isinstance(value, (int, float)):
                    # Might be a timestamp
                    dt = datetime.fromtimestamp(value)
                    return dt.strftime("%Y-%m-%d")
            except Exception as e:
                logger.warning(f"Error formatting date '{value}': {e}")
                return str(value).strip()
            return str(value).strip()
        
        elif field_type == "datetime":
            # Format as yyyy-MM-ddTHH:mm:ssZ
            from datetime import datetime
            try:
                if isinstance(value, str):
                    # Try parsing various datetime formats
                    for fmt in [
                        "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%d %H:%M:%S",
                        "%m/%d/%Y %I:%M:%S %p",
                        "%m/%d/%Y %H:%M:%S"
                    ]:
                        try:
                            dt = datetime.strptime(value.strip(), fmt)
                            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        except ValueError:
                            continue
                    # If parsing fails, return as-is
                    return value.strip()
                elif isinstance(value, (int, float)):
                    dt = datetime.fromtimestamp(value)
                    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except Exception:
                return str(value).strip()
            return str(value).strip()
        
        elif field_type == "number":
            # Format number - remove unnecessary decimals for integers
            try:
                if isinstance(value, str):
                    # Remove commas, dollar signs, etc.
                    cleaned = value.replace(",", "").replace("$", "").strip()
                    # Parse as float to check if it's an integer
                    num_value = float(cleaned)
                    # Check if it's effectively an integer (no fractional part)
                    if num_value.is_integer():
                        return str(int(num_value))
                    else:
                        # For decimals, remove trailing zeros but keep at least one decimal place if needed
                        formatted = str(num_value).rstrip('0').rstrip('.')
                        return formatted if formatted else "0"
                elif isinstance(value, (int, float)):
                    # Check if it's effectively an integer
                    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
                        return str(int(value))
                    else:
                        # For decimals, remove trailing zeros
                        formatted = str(value).rstrip('0').rstrip('.')
                        return formatted if formatted else "0"
            except (ValueError, TypeError):
                return str(value).strip()
        
        elif field_type == "option":
            # Options should already be validated, just return as string
            return str(value).strip()
        
        else:
            # Text field - trim whitespace
            return str(value).strip()
