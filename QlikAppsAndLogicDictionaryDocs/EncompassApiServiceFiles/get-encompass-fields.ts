import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  EncompassApiService,
  EncompassField,
  EncompassCustomFieldFromApi,
} from "../services/encompass-api-service.js";
import { buildResponseHeaders } from "../utils/response-headers.js";

// Environment variables
// const DDB_TABLE_NAME_IMPLEMENTATIONS = process.env.IMPLEMENTATION_TABLE_NAME || ""; // Now handled by EncompassApiService
const DDB_TABLE_NAME_DATA_DICTIONARY =
  process.env.DATA_DICTIONARY_TABLE_NAME || "";
// const ENCOMPASS_API_BASE_URL = process.env.ENCOMPASS_API_BASE_URL || "https://api.elliemae.com/encompass"; // Now handled by EncompassApiService

const endpointOverride: string | undefined = process.env.ENDPOINT_OVERRIDE;

// DDB client for TVMA Data Dictionary (can be refactored later if needed)
let ddbClientTvma: DynamoDBClient;
if (endpointOverride) {
  console.log(
    `[get-encompass-fields] Using DynamoDB endpoint override for TVMA: ${endpointOverride}`
  );
  ddbClientTvma = new DynamoDBClient({
    endpoint: endpointOverride,
    region: "us-east-2",
    credentials: {
      accessKeyId: "LOCALDEVKEY123",
      secretAccessKey: "LOCALDEVSECRETABC",
    },
  });
} else {
  ddbClientTvma = new DynamoDBClient({});
}
const ddbDocClientTvma = DynamoDBDocumentClient.from(ddbClientTvma);

const encompassApiService = new EncompassApiService();

interface TvmaDictionaryField {
  ContextField: string;
}

async function fetchTvmaDataDictionaryFromDb(): Promise<TvmaDictionaryField[]> {
  if (!DDB_TABLE_NAME_DATA_DICTIONARY) {
    console.warn(
      "DATA_DICTIONARY_TABLE_NAME not set. Cannot fetch TVMA dictionary."
    );
    return [];
  }
  console.log(
    `Fetching TVMA Data Dictionary from table: ${DDB_TABLE_NAME_DATA_DICTIONARY}`
  );
  const params: ScanCommandInput = {
    TableName: DDB_TABLE_NAME_DATA_DICTIONARY,
    FilterExpression: "PartitionKey = :pk",
    ExpressionAttributeValues: { ":pk": "DataDictionary 1" },
  };
  try {
    const data = await ddbDocClientTvma.send(new ScanCommand(params));
    const items = data.Items || [];
    console.log(
      `Scan for TVMA Data Dictionary successful. Found ${items.length} entries.`
    );
    return items.map((item) => ({
      ContextField: item.ContextField || item.RowKey || "",
    }));
  } catch (error) {
    console.error("Error fetching TVMA Data Dictionary from DynamoDB:", error);
    throw error;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const clientId = event.pathParameters?.clientId;
  const datesOnly = event.queryStringParameters?.datesOnly === "true";
  const isForMilestones =
    event.queryStringParameters?.isForMilestones === "true";
  const showAllFields = event.queryStringParameters?.showAllFields === "true";

  if (!clientId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Client ID (LOS ID) is required" }),
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    };
  }

  try {
    // Use EncompassApiService
    const rdbFieldsResponse = await encompassApiService.getRdbFields(clientId);
    const customFieldsResponse = await encompassApiService.getCustomFields(clientId);
    
    let rdbFields = rdbFieldsResponse.data;
    const customFieldsFromApi = customFieldsResponse.data;

    const tvmaDictionary: TvmaDictionaryField[] =
      await fetchTvmaDataDictionaryFromDb();
    rdbFields = rdbFields.map((field) => {
      const customFieldInfo = customFieldsFromApi.find(
        (cf) => cf.Id === field.fieldID
      );
      if (
        customFieldInfo &&
        customFieldInfo.Audit?.Data?.toLowerCase() === "timestamp"
      ) {
        return { ...field, fieldType: 2 };
      }
      return field;
    });

    let availableFields = rdbFields;

    if (!showAllFields) {
      const tvmaFieldIdsToFilter = new Set(
        tvmaDictionary.map((f) => f.ContextField.replace("Fields.", ""))
      );
      availableFields = availableFields.filter(
        (field) => !tvmaFieldIdsToFilter.has(field.fieldID)
      );
    }

    if (isForMilestones) {
      console.log(
        "Filtering for milestones: only date fields will be returned."
      );
      availableFields = availableFields.filter(
        (field) => field.fieldType === 2
      );
    } else if (datesOnly) {
      availableFields = availableFields.filter(
        (field) => field.fieldType === 2
      );
    }

    return {
      statusCode: 200,
      headers: buildResponseHeaders(rdbFieldsResponse.concurrency),
      body: JSON.stringify(availableFields),
    };
  } catch (error: any) {
    console.error("Error in get-encompass-fields handler:", error);
    const statusCode =
      error.message?.includes("not found for LOS ID") ||
      error.message?.includes("not found for clientId") ||
      error.message?.includes("token API error")
        ? error.message?.includes("401") || error.response?.status === 401
          ? 401
          : error.message?.includes("not found")
          ? 404
          : 500
        : 500;
    return {
      statusCode: statusCode,
      body: JSON.stringify({
        message: "Failed to get Encompass fields",
        error: error.message,
      }),
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    };
  }
};
