import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const DDB_TABLE_NAME_TOKEN_CACHE =
  process.env.ENCOMPASS_TOKEN_CACHE_TABLE_NAME || "";

const endpointOverride: string | undefined = process.env.ENDPOINT_OVERRIDE;
let ddbClient: DynamoDBClient;

if (endpointOverride) {
  ddbClient = new DynamoDBClient({
    endpoint: endpointOverride,
    region: "us-east-2",
    credentials: {
      accessKeyId: "LOCALDEVKEY123",
      secretAccessKey: "LOCALDEVSECRETABC",
    },
  });
} else {
  ddbClient = new DynamoDBClient({});
}

const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Test if a cached Encompass token is still valid by making a lightweight API call
 * @param token - The full Bearer token string
 * @returns true if token is valid, false if 401/invalid
 */
async function testEncompassToken(token: string): Promise<boolean> {
  try {
    // Use loanPipeline fieldDefinitions endpoint - lightweight, all tokens can access
    const response = await axios.get(
      "https://api.elliemae.com/encompass/v1/loanPipeline/fieldDefinitions",
      {
        headers: { Authorization: token },
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      }
    );

    if (response.status === 401) {
      console.log("[GetTokenFromCache] Token validation failed: 401 Unauthorized");
      return false;
    }

    if (response.status === 200) {
      console.log("[GetTokenFromCache] Token validation passed");
      return true;
    }

    // Other errors (403, 429, etc.) - don't invalidate, might be temporary
    console.log(`[GetTokenFromCache] Token validation got non-200 status: ${response.status}, treating as valid`);
    return true;
  } catch (error: any) {
    console.error("[GetTokenFromCache] Token validation error:", error.message);
    // On network errors, assume token might still be valid (don't invalidate)
    return true;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Support both path parameter and query string
  const cacheKey = event.pathParameters?.cacheKey || event.queryStringParameters?.cacheKey;

  if (!cacheKey) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Cache key is required (provide cacheKey query parameter)",
      }),
    };
  }

  try {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: DDB_TABLE_NAME_TOKEN_CACHE,
        Key: { CacheKey: decodeURIComponent(cacheKey) },
      })
    );

    if (result.Item) {
      const now = Date.now();
      const expiresAt = result.Item.ExpiresAt as number;

      if (expiresAt > now) {
        const timeUntilExpiry = Math.round((expiresAt - now) / 1000 / 60);
        const token = result.Item.Token as string;
        console.log(
          `[GetTokenFromCache] Token found with TTL (expires in ${timeUntilExpiry} minutes), validating...`
        );

        // Validate token with Encompass API before returning it
        const isValid = await testEncompassToken(token);

        if (isValid) {
          console.log("[GetTokenFromCache] Token validated successfully");
          return {
            statusCode: 200,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token: token,
              expiresAt: result.Item.ExpiresAt,
              expiresInMinutes: timeUntilExpiry,
            }),
          };
        } else {
          // Token failed 401 test - delete from cache and return "no token"
          console.log("[GetTokenFromCache] Token failed validation (401), deleting from cache");
          await ddbDocClient.send(
            new DeleteCommand({
              TableName: DDB_TABLE_NAME_TOKEN_CACHE,
              Key: { CacheKey: decodeURIComponent(cacheKey) },
            })
          );

          return {
            statusCode: 200,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: "Cached token was invalid (deleted)",
            }),
          };
        }
      } else {
        console.log("[GetTokenFromCache] Token found but expired");
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Token expired",
          }),
        };
      }
    } else {
      console.log("[GetTokenFromCache] No token found in cache");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "No token found in cache",
        }),
      };
    }
  } catch (error: any) {
    console.error("[GetTokenFromCache] Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        message: "Failed to retrieve token from cache",
        error: error.message,
      }),
    };
  }
};
