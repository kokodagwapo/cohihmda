export const unifiedChatRequestSchema: Record<string, unknown> = {
  $id: "https://cohi.local/schemas/chat/v1/request.json",
  title: "CohiUnifiedChatRequest",
  type: "object",
  required: ["message"],
  properties: {
    message: {
      type: "string",
      minLength: 1,
      description: "User message text.",
    },
    conversationId: {
      type: "string",
      format: "uuid",
      description: "Existing conversation; server creates if omitted when starting a new thread.",
    },
    clientMessageId: {
      type: "string",
      format: "uuid",
      description: "Idempotency key for POST retries; server dedupes duplicate turns.",
    },
    scope: {
      type: "object",
      required: ["type"],
      properties: {
        type: {
          type: "string",
          enum: ["global_session", "canvas", "draft", "insight", "widget_edit", "workbench_hub"],
        },
        id: {
          type: "string",
          description: "Scoped entity id when applicable (canvas uuid, draft uuid, insight id).",
        },
      },
      additionalProperties: false,
    },
    location: {
      type: "object",
      required: ["surface"],
      properties: {
        surface: {
          type: "string",
          enum: ["site", "workbench_canvas", "workbench_hub", "insight_modal", "data_chat_page"],
        },
        route: { type: "string" },
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    context: {
      type: "object",
      description: "Optional rich context; policy layer may truncate.",
      properties: {
        canvasState: { type: "object" },
        widgetCatalog: { type: "string" },
        widgetEdit: {
          type: "object",
          properties: {
            widgetId: { type: "string" },
            sql: { type: "string" },
            vizConfig: { type: "object" },
          },
        },
        insightContext: { type: "object" },
        sourceInsight: { type: "object" },
      },
      additionalProperties: true,
    },
    history: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: { type: "string" },
        },
        additionalProperties: false,
      },
      description: "Optimistic client history; server merges with authoritative transcript.",
    },
    options: {
      type: "object",
      properties: {
        stream: { type: "boolean", default: false },
        includeRag: { type: "boolean", default: true },
        includeLiveCanvasData: { type: "boolean", default: true },
        maxHistoryTurns: { type: "integer", minimum: 0, maximum: 50 },
        personaHints: {
          type: "array",
          items: { type: "string" },
        },
        qaAgentRunTag: { type: "string" },
        planningMode: {
          type: "string",
          enum: ["auto", "always", "never"],
          default: "auto",
          description: "Whether to use planner loop vs single-shot completion for complex turns.",
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const unifiedChatResponseSchema: Record<string, unknown> = {
  $id: "https://cohi.local/schemas/chat/v1/response.json",
  title: "CohiUnifiedChatResponse",
  type: "object",
  required: ["conversationId", "turn"],
  properties: {
    conversationId: { type: "string", format: "uuid" },
    turn: {
      type: "object",
      required: ["id", "blocks"],
      properties: {
        id: { type: "string", format: "uuid" },
        blocks: {
          type: "array",
          items: { $ref: "#/$defs/block" },
        },
      },
      additionalProperties: false,
    },
    metadata: {
      type: "object",
      properties: {
        modelId: { type: "string" },
        promptHash: { type: "string" },
        policyDecisionId: { type: "string" },
        contextManifest: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tier: { type: "string" },
              included: { type: "boolean" },
              truncated: { type: "boolean" },
            },
          },
        },
        compactionWatermark: {
          type: "string",
          description: "Monotonic cursor after transcript/snapshot compaction (opaque).",
        },
        suggestedQuestions: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: true,
    },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
  },
  $defs: {
    block: {
      oneOf: [
        {
          title: "text",
          type: "object",
          required: ["type", "markdown"],
          properties: {
            type: { const: "text" },
            markdown: { type: "string" },
          },
          additionalProperties: false,
        },
        {
          title: "citations",
          type: "object",
          required: ["type", "items"],
          properties: {
            type: { const: "citations" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  snippet: { type: "string" },
                  uri: { type: "string" },
                },
              },
            },
          },
          additionalProperties: false,
        },
        {
          title: "visualization",
          type: "object",
          required: ["type", "config"],
          properties: {
            type: { const: "visualization" },
            artifactId: { type: "string" },
            config: {
              type: "object",
              description: "VisualizationConfig successor (bar, line, table, ...).",
            },
          },
          additionalProperties: true,
        },
        {
          title: "actions",
          type: "object",
          required: ["type", "items"],
          properties: {
            type: { const: "actions" },
            items: {
              type: "array",
              items: { type: "object" },
            },
            teachingNotes: { type: "string" },
          },
          additionalProperties: false,
        },
        {
          title: "artifacts",
          type: "object",
          required: ["type", "items"],
          properties: {
            type: { const: "artifacts" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: ["ppt_export", "canvas_build", "file", "chart_ref"],
                  },
                  ref: { type: "string" },
                  meta: { type: "object" },
                },
              },
            },
          },
          additionalProperties: false,
        },
        {
          title: "navigation_hints",
          type: "object",
          required: ["type", "items"],
          properties: {
            type: { const: "navigation_hints" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  path: { type: "string" },
                },
              },
            },
          },
          additionalProperties: false,
        },
        {
          title: "safety",
          type: "object",
          required: ["type", "reason"],
          properties: {
            type: { const: "safety" },
            reason: { type: "string" },
            category: { type: "string" },
          },
          additionalProperties: false,
        },
      ],
    },
  },
  additionalProperties: false,
};

export const unifiedChatStreamEventSchema: Record<string, unknown> = {
  $id: "https://cohi.local/schemas/chat/v1/event-stream.json",
  title: "CohiUnifiedChatStreamEvent",
  type: "object",
  required: ["event"],
  properties: {
    event: {
      type: "string",
      enum: ["turn.started", "block.started", "block.delta", "block.completed", "turn.completed", "error", "ping"],
    },
    conversationId: { type: "string", format: "uuid" },
    turnId: { type: "string", format: "uuid" },
    blockIndex: { type: "integer", minimum: 0 },
    blockType: {
      type: "string",
      enum: ["text", "citations", "visualization", "actions", "artifacts", "navigation_hints", "safety"],
    },
    delta: {
      type: "string",
      description: "Incremental markdown or JSON fragment for block.delta.",
    },
    block: {
      description: "Completed block payload (same shapes as chat-response blocks).",
      type: "object",
    },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        retryable: { type: "boolean" },
      },
    },
    metadata: { type: "object" },
  },
  additionalProperties: false,
};
