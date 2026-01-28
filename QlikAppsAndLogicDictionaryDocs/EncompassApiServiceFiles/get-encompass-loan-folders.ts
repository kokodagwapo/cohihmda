import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { EncompassApiService } from "../services/encompass-api-service.js";
import { buildResponseHeaders } from "../utils/response-headers.js";

const encompassApiService = new EncompassApiService();

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const clientId = event.pathParameters?.clientId;

  if (!clientId) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        message: "Client ID is required in path parameters.",
      }),
    };
  }

  try {
    const response = await encompassApiService.getLoanFolders(clientId);

    return {
      statusCode: 200,
      headers: buildResponseHeaders(response.concurrency),
      body: JSON.stringify(response.data),
    };
  } catch (error: any) {
    console.error("Error fetching Encompass loan folders:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        message: "Failed to fetch Encompass loan folders.",
        error: error.message,
      }),
    };
  }
};
