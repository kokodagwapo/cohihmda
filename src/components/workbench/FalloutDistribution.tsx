/**
 * Fallout Distribution
 * Standalone component for managing fallout alert distribution settings and LO responses.
 * Used in the Communications Center as a dedicated tab.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

interface FalloutAlertConfigState {
  enabled: boolean;
  min_risk_score: number;
  frequency: "realtime" | "daily_digest" | "weekly_digest";
  include_risk_levels: string[];
  custom_message: string | null;
  notify_managers: boolean;
  target_encompass_user_ids: string[];
  manager_user_ids: string[];
}

interface FalloutAlertResponseRow {
  id: string;
  alert_batch_id: string;
  loan_id: string;
  loan_number: string | null;
  loan_officer: string | null;
  recipient_email: string | null;
  response: "acknowledged" | "working_on_it" | "need_help";
  responded_at: string;
}

interface FalloutRecipientLoanOfficer {
  encompass_user_id: string;
  display_name: string;
  email: string;
  active_loan_count: number;
}

interface FalloutRecipientManager {
  id: string;
  display_name: string;
  email: string;
  role: string;
}

const parseManualTestEmails = (rawInput: string): string[] =>
  Array.from(
    new Set(
      rawInput
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    ),
  );

interface FalloutDistributionProps {
  selectedTenantId?: string | null;
}

export function FalloutDistribution({ selectedTenantId }: FalloutDistributionProps) {
  const [subTab, setSubTab] = useState<"settings" | "responses">("settings");

  const [falloutAlertConfig, setFalloutAlertConfig] = useState<FalloutAlertConfigState>({
    enabled: false,
    min_risk_score: 75,
    frequency: "daily_digest",
    include_risk_levels: ["Very High", "High"],
    custom_message: "",
    notify_managers: false,
    target_encompass_user_ids: [],
    manager_user_ids: [],
  });
  const [falloutAlertResponses, setFalloutAlertResponses] = useState<FalloutAlertResponseRow[]>([]);
  const [falloutLoanOfficerOptions, setFalloutLoanOfficerOptions] = useState<FalloutRecipientLoanOfficer[]>([]);
  const [falloutManagerOptions, setFalloutManagerOptions] = useState<FalloutRecipientManager[]>([]);
  const [falloutBranchOptions, setFalloutBranchOptions] = useState<string[]>([]);

  const [loSearchTerm, setLoSearchTerm] = useState("");
  const [loSortMode, setLoSortMode] = useState<"active_desc" | "name_asc">("active_desc");
  const [responseSearchTerm, setResponseSearchTerm] = useState("");
  const [responseTypeFilter, setResponseTypeFilter] = useState<"all" | "acknowledged" | "working_on_it" | "need_help">("all");
  const [manualTestRecipientsInput, setManualTestRecipientsInput] = useState("");
  const [sendManagerCards, setSendManagerCards] = useState(false);
  const [managerCardScopeToSelectedLos, setManagerCardScopeToSelectedLos] = useState(true);
  const [managerCardBranchFilters, setManagerCardBranchFilters] = useState<string[]>([]);

  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [redirectActive, setRedirectActive] = useState(false);
  const [redirectEmails, setRedirectEmails] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    try {
      setConfigLoading(true);
      const [configResult, responsesResult, optionsResult] = await Promise.all([
        api.getFalloutAlertConfig(selectedTenantId || undefined),
        api.getFalloutAlertResponses(100, selectedTenantId || undefined),
        api.getFalloutAlertRecipientOptions(selectedTenantId || undefined),
      ]);
      const rawConfig = configResult?.config as Partial<FalloutAlertConfigState> | undefined;
      if (rawConfig) {
        setFalloutAlertConfig((prev) => ({
          ...prev,
          ...rawConfig,
          custom_message: (rawConfig.custom_message as string | null) || "",
          include_risk_levels: Array.isArray(rawConfig.include_risk_levels)
            ? rawConfig.include_risk_levels
            : ["Very High", "High"],
          target_encompass_user_ids: Array.isArray(rawConfig.target_encompass_user_ids)
            ? rawConfig.target_encompass_user_ids
            : [],
          manager_user_ids: Array.isArray(rawConfig.manager_user_ids)
            ? rawConfig.manager_user_ids
            : [],
        }));
      }
      const cfg = configResult as any;
      setRedirectActive(cfg?.devMode === true);
      setRedirectEmails(Array.isArray(cfg?.devAllowedEmails) ? cfg.devAllowedEmails : []);
      setFalloutAlertResponses(
        Array.isArray(responsesResult?.responses)
          ? (responsesResult.responses as FalloutAlertResponseRow[])
          : [],
      );
      setFalloutLoanOfficerOptions(
        Array.isArray(optionsResult?.loanOfficers) ? optionsResult.loanOfficers : [],
      );
      setFalloutManagerOptions(
        Array.isArray(optionsResult?.managers) ? optionsResult.managers : [],
      );
      setFalloutBranchOptions(
        Array.isArray(optionsResult?.branches)
          ? optionsResult.branches.filter((v: unknown): v is string => typeof v === "string")
          : [],
      );
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to load fallout alert settings.");
    } finally {
      setConfigLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = useCallback(async () => {
    try {
      setConfigSaving(true);
      setMessage(null);
      await api.updateFalloutAlertConfig(
        { ...falloutAlertConfig, custom_message: falloutAlertConfig.custom_message || null },
        selectedTenantId || undefined,
      );
      setMessage("Settings saved.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setConfigSaving(false);
    }
  }, [falloutAlertConfig, selectedTenantId]);

  const manualTestRecipientCount = parseManualTestEmails(manualTestRecipientsInput).length;
  const selectedLoCount = falloutAlertConfig.target_encompass_user_ids.length;
  const canSend =
    selectedLoCount > 0 ||
    falloutAlertConfig.notify_managers ||
    sendManagerCards ||
    manualTestRecipientCount > 0;

  const handleSendNow = useCallback(async () => {
    try {
      setSending(true);
      setMessage(null);
      const manualRecipients = parseManualTestEmails(manualTestRecipientsInput);
      const result = await api.sendFalloutAlertsNow(selectedTenantId || undefined, {
        test_recipient_emails: manualRecipients,
        send_manager_cards: sendManagerCards,
        manager_card_branch_filters: managerCardBranchFilters,
        manager_card_scope_to_target_los: managerCardScopeToSelectedLos,
      });
      const resultAny = result as any;
      const redirectPrefix = resultAny.devMode && resultAny.devRedirectedTo?.length
        ? `[Redirect: → ${resultAny.devRedirectedTo.join(", ")}] `
        : resultAny.devMode ? "[Redirect active — emails blocked] " : "";
      const base = `${redirectPrefix}Sent ${resultAny.sentCount}/${resultAny.recipientsCount} emails (${resultAny.skippedLoansCount} loans skipped: no LO email match).`;
      const mgr = resultAny.managerCardNotifications?.attempted > 0 || sendManagerCards
        ? ` Manager cards: ${resultAny.managerCardNotifications.sent}/${resultAny.managerCardNotifications.attempted}.`
        : "";
      const test = resultAny.testRecipients?.attempted > 0
        ? ` Test recipients: ${resultAny.testRecipients.sent}/${resultAny.testRecipients.attempted}.`
        : "";
      setMessage(`${base}${mgr}${test}`);
      await loadData();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to send fallout alerts.");
    } finally {
      setSending(false);
    }
  }, [
    selectedTenantId,
    manualTestRecipientsInput,
    sendManagerCards,
    managerCardBranchFilters,
    managerCardScopeToSelectedLos,
    loadData,
  ]);

  const visibleLoanOfficerOptions = useMemo(() => {
    const query = loSearchTerm.trim().toLowerCase();
    const filtered = falloutLoanOfficerOptions.filter((lo) => {
      if (!query) return true;
      return (
        lo.display_name.toLowerCase().includes(query) ||
        lo.email.toLowerCase().includes(query)
      );
    });
    const selectedSet = new Set(falloutAlertConfig.target_encompass_user_ids);
    return [...filtered].sort((a, b) => {
      if (loSortMode === "active_desc") {
        const aSelected = selectedSet.has(a.encompass_user_id) ? 1 : 0;
        const bSelected = selectedSet.has(b.encompass_user_id) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        return (b.active_loan_count || 0) - (a.active_loan_count || 0);
      }
      return a.display_name.localeCompare(b.display_name);
    });
  }, [falloutLoanOfficerOptions, loSearchTerm, loSortMode, falloutAlertConfig.target_encompass_user_ids]);

  const filteredResponses = useMemo(() => {
    const query = responseSearchTerm.trim().toLowerCase();
    return falloutAlertResponses.filter((row) => {
      if (responseTypeFilter !== "all" && row.response !== responseTypeFilter) return false;
      if (!query) return true;
      return (
        (row.loan_number || row.loan_id).toLowerCase().includes(query) ||
        (row.loan_officer || "").toLowerCase().includes(query) ||
        (row.recipient_email || "").toLowerCase().includes(query)
      );
    });
  }, [falloutAlertResponses, responseSearchTerm, responseTypeFilter]);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setSubTab("settings")}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${
            subTab === "settings"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          Settings
        </button>
        <button
          type="button"
          onClick={() => setSubTab("responses")}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${
            subTab === "responses"
              ? "bg-indigo-600 text-white"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          LO Responses
          {falloutAlertResponses.length > 0 && (
            <span className="ml-1.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px]">
              {falloutAlertResponses.length}
            </span>
          )}
        </button>
      </div>

      {/* Redirect warning banner */}
      {redirectActive && (
        <div className={`rounded-lg border px-4 py-3 text-xs ${
          redirectEmails.length > 0
            ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
            : "border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300"
        }`}>
          <p className="font-semibold mb-0.5">
            {redirectEmails.length > 0 ? "⚠ Email Redirect Active" : "🛑 Email Redirect Active — No Safe Addresses"}
          </p>
          <p>
            {redirectEmails.length > 0
              ? `All LO and manager emails will be redirected to: ${redirectEmails.join(", ")}. No real users will be contacted.`
              : "Email redirect is enabled but no safe addresses are configured. All LO/manager emails are blocked. Configure redirect addresses in Platform Settings."}
          </p>
        </div>
      )}

      {configLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
          Loading...
        </div>
      ) : (
        <>
          {subTab === "settings" && (
            <div className="space-y-4">
              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendNow}
                  disabled={sending || configLoading || !canSend}
                  className="text-xs"
                  title={!canSend ? "Select at least one LO, enable manager notifications, or add test recipient emails" : undefined}
                >
                  {sending ? "Sending..." : "Send Alerts Now"}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={configSaving || configLoading}
                  className="text-xs"
                >
                  {configSaving ? "Saving..." : "Save Settings"}
                </Button>
              </div>

              {/* Basic config row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Enabled</span>
                  <Switch
                    checked={falloutAlertConfig.enabled}
                    onCheckedChange={(checked) =>
                      setFalloutAlertConfig((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </label>
                <label className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Minimum Risk Score
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={falloutAlertConfig.min_risk_score}
                    onChange={(e) =>
                      setFalloutAlertConfig((prev) => ({
                        ...prev,
                        min_risk_score: Math.max(0, Math.min(100, Number(e.target.value || 0))),
                      }))
                    }
                    className="h-8 text-xs"
                  />
                </label>
                <label className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Frequency
                  </span>
                  <select
                    value={falloutAlertConfig.frequency}
                    onChange={(e) =>
                      setFalloutAlertConfig((prev) => ({
                        ...prev,
                        frequency: e.target.value as "realtime" | "daily_digest" | "weekly_digest",
                      }))
                    }
                    className="h-8 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs"
                  >
                    <option value="realtime">Realtime</option>
                    <option value="daily_digest">Daily Digest</option>
                    <option value="weekly_digest">Weekly Digest</option>
                  </select>
                </label>
              </div>

              {/* Risk levels + notify managers */}
              <div className="flex flex-wrap gap-3 text-xs text-slate-700 dark:text-slate-300">
                {["Very High", "High", "Medium", "Low"].map((level) => (
                  <label key={level} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={falloutAlertConfig.include_risk_levels.includes(level)}
                      onChange={(e) =>
                        setFalloutAlertConfig((prev) => ({
                          ...prev,
                          include_risk_levels: e.target.checked
                            ? Array.from(new Set([...prev.include_risk_levels, level]))
                            : prev.include_risk_levels.filter((v) => v !== level),
                        }))
                      }
                    />
                    {level}
                  </label>
                ))}
                <label className="flex items-center gap-1.5 ml-2">
                  <span>Notify Managers</span>
                  <Switch
                    checked={falloutAlertConfig.notify_managers}
                    onCheckedChange={(checked) =>
                      setFalloutAlertConfig((prev) => ({ ...prev, notify_managers: checked }))
                    }
                  />
                </label>
              </div>

              {/* LO + Manager targeting */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Target Loan Officers
                  </p>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Optional. Selected LOs receive actionable card emails.
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      value={loSearchTerm}
                      onChange={(e) => setLoSearchTerm(e.target.value)}
                      placeholder="Search LO by name or email..."
                      className="h-8 text-xs"
                    />
                    <select
                      value={loSortMode}
                      onChange={(e) => setLoSortMode(e.target.value as "active_desc" | "name_asc")}
                      className="h-8 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs"
                    >
                      <option value="active_desc">Most Active</option>
                      <option value="name_asc">Name A-Z</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                    <span>Selected: {selectedLoCount}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="underline hover:text-slate-700 dark:hover:text-slate-300"
                        onClick={() =>
                          setFalloutAlertConfig((prev) => ({
                            ...prev,
                            target_encompass_user_ids: Array.from(
                              new Set([
                                ...prev.target_encompass_user_ids,
                                ...visibleLoanOfficerOptions.map((lo) => lo.encompass_user_id),
                              ]),
                            ),
                          }))
                        }
                      >
                        Select all visible
                      </button>
                      <button
                        type="button"
                        className="underline hover:text-slate-700 dark:hover:text-slate-300"
                        onClick={() =>
                          setFalloutAlertConfig((prev) => ({
                            ...prev,
                            target_encompass_user_ids: [],
                          }))
                        }
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto space-y-1">
                    {visibleLoanOfficerOptions.map((lo) => (
                      <label key={lo.encompass_user_id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={falloutAlertConfig.target_encompass_user_ids.includes(lo.encompass_user_id)}
                          onChange={(e) =>
                            setFalloutAlertConfig((prev) => ({
                              ...prev,
                              target_encompass_user_ids: e.target.checked
                                ? Array.from(new Set([...prev.target_encompass_user_ids, lo.encompass_user_id]))
                                : prev.target_encompass_user_ids.filter((id) => id !== lo.encompass_user_id),
                            }))
                          }
                        />
                        <span className="flex items-center gap-2">
                          <span>{lo.display_name} ({lo.email})</span>
                          <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px]">
                            {lo.active_loan_count || 0} active
                          </span>
                        </span>
                      </label>
                    ))}
                    {visibleLoanOfficerOptions.length === 0 && (
                      <p className="text-[11px] text-slate-500">No loan officers found.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                    Manager Recipients
                  </p>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Used when "Notify Managers" is enabled. If none selected, all managers/admins are notified.
                  </p>
                  <div className="max-h-40 overflow-auto space-y-1">
                    {falloutManagerOptions.map((manager) => (
                      <label key={manager.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={falloutAlertConfig.manager_user_ids.includes(manager.id)}
                          onChange={(e) =>
                            setFalloutAlertConfig((prev) => ({
                              ...prev,
                              manager_user_ids: e.target.checked
                                ? Array.from(new Set([...prev.manager_user_ids, manager.id]))
                                : prev.manager_user_ids.filter((id) => id !== manager.id),
                            }))
                          }
                        />
                        <span>{manager.display_name} ({manager.role})</span>
                      </label>
                    ))}
                    {falloutManagerOptions.length === 0 && (
                      <p className="text-[11px] text-slate-500">No managers found.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Manager card delivery */}
              <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Manager Card Delivery (Send Now)
                  </p>
                  <Switch checked={sendManagerCards} onCheckedChange={setSendManagerCards} />
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Send managers a separate email with loan cards in addition to the summary report.
                </p>
                {sendManagerCards && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 mb-2">
                      <input
                        type="checkbox"
                        checked={managerCardScopeToSelectedLos}
                        onChange={(e) => setManagerCardScopeToSelectedLos(e.target.checked)}
                      />
                      Scope cards to selected target LOs
                    </label>
                    <p className="text-[11px] text-slate-500 mb-1">Optional branch filter</p>
                    <div className="max-h-24 overflow-auto rounded border border-slate-200 dark:border-slate-700 p-2 space-y-1">
                      {falloutBranchOptions.length === 0 ? (
                        <p className="text-[11px] text-slate-500">No branches found.</p>
                      ) : (
                        falloutBranchOptions.map((branch) => (
                          <label key={branch} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={managerCardBranchFilters.includes(branch)}
                              onChange={(e) =>
                                setManagerCardBranchFilters((prev) =>
                                  e.target.checked
                                    ? Array.from(new Set([...prev, branch]))
                                    : prev.filter((v) => v !== branch),
                                )
                              }
                            />
                            <span>{branch}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Manual test recipients */}
              <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Manual Test Recipients
                </p>
                <p className="text-[11px] text-slate-500 mb-2">
                  Send test loan cards to specific emails without selecting any LOs.
                </p>
                <Textarea
                  rows={2}
                  value={manualTestRecipientsInput}
                  onChange={(e) => setManualTestRecipientsInput(e.target.value)}
                  placeholder="name@company.com, qa@company.com"
                  className="text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Parsed test recipients: {manualTestRecipientCount}
                </p>
              </div>

              {/* Custom message */}
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custom message (included in LO emails)
                </p>
                <Textarea
                  rows={2}
                  value={falloutAlertConfig.custom_message || ""}
                  onChange={(e) =>
                    setFalloutAlertConfig((prev) => ({
                      ...prev,
                      custom_message: e.target.value,
                    }))
                  }
                  placeholder="Optional message to include in LO emails..."
                  className="text-xs"
                />
              </div>

              {/* Result message */}
              {message && (
                <p className="text-xs text-slate-600 dark:text-slate-300 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-2">
                  {message}
                </p>
              )}
            </div>
          )}

          {subTab === "responses" && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={responseSearchTerm}
                  onChange={(e) => setResponseSearchTerm(e.target.value)}
                  placeholder="Search loan number, LO, or recipient email..."
                  className="h-8 text-xs"
                />
                <select
                  value={responseTypeFilter}
                  onChange={(e) =>
                    setResponseTypeFilter(e.target.value as "all" | "acknowledged" | "working_on_it" | "need_help")
                  }
                  className="h-8 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-xs"
                >
                  <option value="all">All responses</option>
                  <option value="acknowledged">Resolved</option>
                  <option value="working_on_it">Working on it</option>
                  <option value="need_help">Need help</option>
                </select>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="text-left p-2 whitespace-nowrap">Loan</th>
                      <th className="text-left p-2 whitespace-nowrap">Officer</th>
                      <th className="text-left p-2 whitespace-nowrap">Recipient</th>
                      <th className="text-left p-2 whitespace-nowrap">Response</th>
                      <th className="text-left p-2 whitespace-nowrap">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResponses.length === 0 ? (
                      <tr>
                        <td className="p-3 text-slate-500" colSpan={5}>
                          No responses match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredResponses.map((row) => (
                        <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
                          <td className="p-2">{row.loan_number || row.loan_id}</td>
                          <td className="p-2">{row.loan_officer || "-"}</td>
                          <td className="p-2">{row.recipient_email || "-"}</td>
                          <td className="p-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              row.response === "acknowledged"
                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                : row.response === "working_on_it"
                                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                  : "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                            }`}>
                              {row.response === "acknowledged" ? "Resolved" : row.response === "working_on_it" ? "Working on it" : row.response === "need_help" ? "Need help" : row.response.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="p-2 whitespace-nowrap">{new Date(row.responded_at).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
