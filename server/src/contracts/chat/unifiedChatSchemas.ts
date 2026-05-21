export const UNIFIED_CHAT_TYPE_ENUM = [
  "chat",
  "research",
  "insight_builder",
  "workbench",
] as const;

export const unifiedChatRequestSchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cohi.local/schemas/chat/v1/request.json",
  title: "CohiUnifiedChatRequest",
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, description: "User message text." },
    chat_type: {
      type: "string",
      enum: [...UNIFIED_CHAT_TYPE_ENUM],
      default: "chat",
      description: "Product mode; default chat for new sessions (meeting spec §10 #1).",
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
        insightBuilderDraft: {
          type: "object",
          description: "Insight builder pending draft (approve/revise).",
          properties: {
            title: { type: "string" },
            prompt_text: { type: "string" },
            schedule: { type: "string", enum: ["batch", "on_demand"] },
            prompt_tag: { type: "string" },
            specifiers: { type: "object" },
          },
        },
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
        personaHints: { type: "array", items: { type: "string" } },
        qaAgentRunTag: { type: "string" },
        datasetUploadIds: {
          type: "array",
          items: { type: "string", format: "uuid" },
          maxItems: 10,
          description:
            "Research upload IDs (CSV datasets) attached to this conversation turn.",
        },
        // Deferred — restore with promptComposer + orchestrator planningMode.
        // planningMode: {
        //   type: "string",
        //   enum: ["auto", "always", "never"],
        //   default: "auto",
        //   description: "Whether to use planner loop vs single-shot completion for complex turns.",
        // },
        research: {
          type: "object",
          description: "Research-only options (deep analysis when chat_type is research).",
          properties: {
            deepAnalysis: {
              type: "boolean",
              default: false,
              description: "Deep analysis mode; only meaningful when chat_type is research.",
            },
            uploadIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
              maxItems: 10,
              description: "Research dataset upload IDs to attach when starting a new session.",
            },
          },
          additionalProperties: false,
        },
        insightBuilder: {
          type: "object",
          description: "Insight builder actions (approve / revise).",
          properties: {
            action: { type: "string", enum: ["approve", "revise"] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  allOf: [
    {
      if: {
        properties: {
          options: {
            type: "object",
            properties: {
              research: {
                type: "object",
                properties: { deepAnalysis: { const: true } },
                required: ["deepAnalysis"],
              },
            },
            required: ["research"],
          },
        },
        required: ["options"],
      },
      then: {
        properties: { chat_type: { const: "research" } },
        required: ["chat_type"],
      },
    },
    {
      if: {
        properties: {
          options: {
            type: "object",
            properties: {
              research: {
                type: "object",
                required: ["uploadIds"],
                properties: {
                  uploadIds: {
                    type: "array",
                    minItems: 1,
                  },
                },
              },
            },
            required: ["research"],
          },
        },
        required: ["options"],
      },
      then: {
        properties: { chat_type: { const: "research" } },
        required: ["chat_type"],
      },
    },
    {
      if: {
        properties: {
          options: {
            type: "object",
            properties: { research: { type: "object" } },
            required: ["research"],
          },
        },
        required: ["options"],
      },
      then: {
        properties: { chat_type: { const: "research" } },
        required: ["chat_type"],
      },
    },
    {
      if: {
        properties: {
          chat_type: { const: "insight_builder" },
          options: {
            type: "object",
            properties: {
              datasetUploadIds: {
                type: "array",
                minItems: 1,
              },
            },
            required: ["datasetUploadIds"],
          },
        },
        required: ["options"],
      },
      then: false,
    },
  ],
  additionalProperties: false,
};

export const unifiedChatResponseSchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
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
        blocks: { type: "array", items: { $ref: "#/$defs/block" } },
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
        suggestedQuestions: { type: "array", items: { type: "string" } },
        chatType: {
          type: "string",
          enum: [...UNIFIED_CHAT_TYPE_ENUM],
          description: "Echo of request chat_type for this turn.",
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
            items: { type: "array", items: { type: "object" } },
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
                  meta: {
                    type: "object",
                    description:
                      "Opaque per-artifact metadata (e.g. insightBuilderPreview from insightBuilderTurn).",
                  },
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
  $schema: "https://json-schema.org/draft/2020-12/schema",
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

const scopeSchema: Record<string, unknown> = {
  type: "object",
  required: ["type"],
  properties: {
    type: {
      type: "string",
      enum: ["global_session", "canvas", "draft", "insight", "widget_edit", "workbench_hub"],
    },
    id: { type: "string", description: "Scoped entity id when applicable." },
  },
  additionalProperties: false,
};

/** POST /api/chat/v1/conversations */
export const unifiedChatConversationCreateBodySchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cohi.local/schemas/chat/v1/conversation-create.json",
  title: "CohiUnifiedChatConversationCreate",
  type: "object",
  required: ["scope"],
  properties: {
    scope: scopeSchema,
    chat_type: {
      type: "string",
      enum: [...UNIFIED_CHAT_TYPE_ENUM],
      default: "chat",
    },
    title: { type: "string", maxLength: 200 },
    legacy_ref: { type: "string", maxLength: 500, description: "Optional pointer for COHI-395 legacy bridge." },
  },
  additionalProperties: false,
};

/** POST /api/chat/v1/conversations/:id/rebind */
export const unifiedChatConversationRebindBodySchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cohi.local/schemas/chat/v1/conversation-rebind.json",
  title: "CohiUnifiedChatConversationRebind",
  type: "object",
  required: ["scope"],
  properties: {
    scope: scopeSchema,
    chat_type: { type: "string", enum: [...UNIFIED_CHAT_TYPE_ENUM] },
  },
  additionalProperties: false,
};

export const UNIFIED_CHAT_SCHEMAS: ReadonlyArray<{ fileName: string; schema: Record<string, unknown> }> = [
  { fileName: "chat-request.schema.json", schema: unifiedChatRequestSchema },
  { fileName: "chat-response.schema.json", schema: unifiedChatResponseSchema },
  { fileName: "chat-event-stream.schema.json", schema: unifiedChatStreamEventSchema },
];
