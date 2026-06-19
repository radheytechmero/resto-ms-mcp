import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import axios from "axios";
import z from "zod";
import "dotenv/config";

const app = express();
app.use(express.json());

const backendSecret = process.env.BACKEND_SECRET;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, mcp-protocol-version, mcp-proxy-auth-token"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

const RESTO_MS_API_BASE_URL = process.env.BACKEND_BASE_URL || "http://localhost:5000";

function createServer() {
  const server = new McpServer({
    name: "resto-ms-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search-menu-item",
    {
      description: "Search menu items",
      inputSchema: {
        query: z.string(),
        no: z.string().describe("Restaurant phone number"),
        restaurantId: z.string().optional(),
        limit: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const { data } = await axios.get(
          `${RESTO_MS_API_BASE_URL}/api/menu-items/search`,
          {
            params: input,
            headers: {
              "x-agent-secret": backendSecret,
            },
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err: any) {
        console.error(
          err?.response?.data || err?.message || err
        );

        return {
          content: [
            {
              type: "text",
              text: "Failed to search menu items",
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get-menu-item-details",
    {
      description: "Get detailed information about a specific menu item",
      inputSchema: {
        menuUID: z.string().describe("Unique identifier of the menu item"),
      },
    },
    async (input) => {
      try {
        const response = await axios.get(
          `${RESTO_MS_API_BASE_URL}/api/menu-items/${input.menuUID}`,
          {
            headers: {
              "x-agent-secret": backendSecret,
              "Content-Type": "application/json",
            },
          }
        );
        
        const item = response.data;
        console.log("Menu item response:", item);

        if (!item || Object.keys(item).length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Menu item not found.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(item),
            },
          ],
        };
      } catch (error: any) {
        console.error("Get menu item error:", error?.response?.data || error?.message || error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to get menu item details: ${error?.response?.data?.message || error?.message || "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create-order",
    {
      description: "Create a restaurant order",
      inputSchema: {
        customerName: z.string(),
        customerEmail: z
          .string()
          .email()
          .optional()
          .or(z.literal("")),
        tableNumber: z.string().optional(),
        orderType: z
          .enum(["dine-in", "takeaway", "delivery"])
          .optional(),
        orderItems: z.array(
          z.object({
            id: z.number(),
            menuUID: z.string(),
            menuItemName: z.string(),
            quantity: z.number().min(1),
            price: z.number(),
            size: z.enum(["small", "medium", "large", "extra-large"]).optional(),
            customizations: z
              .array(
                z.object({
                  id: z.string().describe("Clover modifier ID"),
                  name: z.string().describe("Modifier name"),
                  price: z.number().describe("Additional price in dollars"),
                })
              )
              .optional()
              .describe("Selected modifiers/options"),
            notes: z.string().optional().describe("Special notes for this item"),
          })
        ),
        from: z.string().describe("Customer phone number"),
        to: z.string().describe("Restaurant phone number"),
        specialRequests: z.string().optional().describe("Special requests for the entire order"),
      },
    },
    async (input) => {
      try {
        const payload = { ...input };
        if (!payload.customerEmail) {
          delete payload.customerEmail;
        }

        const response = await axios.post(
          `${RESTO_MS_API_BASE_URL}/api/create-order`,
          payload,
          {
            headers: {
              "x-agent-secret": backendSecret,
            },
          }
        );
        return {
          content: [
            {
              type: "text",
              text: `Order created successfully. Order ID: ${response.data.id}`,
            },
          ],
        };
      } catch (error) {
        console.error(error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to create order",
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'send-sms',
    {
      description: 'Send an SMS message',
      inputSchema: {
        to: z.string().describe('Customer phone number (called_number)'),
        from: z.string().describe('Restaurant phone number (caller_number)'),
        message: z.string().describe('Message content'),
      },
    },
    async (input) => {
      try {
        await axios.post(
          `${RESTO_MS_API_BASE_URL}/api/twilio/send-message`,
          input,
          {
            headers: {
              "x-agent-secret": backendSecret,
            },
          }
        );
        return {
          content: [
            {
              type: "text",
              text: "SMS sent successfully",
            },
          ],
        };
      } catch (error) {
        console.error(error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to send SMS",
            },
          ],
          isError: true,
        };
      }
    }
  )

  return server;
}

app.all("/mcp", async (req, res) => {
  try {
    console.log("========== MCP REQUEST ==========");
    console.log(req.method);
    console.log(req.headers);
    console.log(JSON.stringify(req.body, null, 2));

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    transport.onclose = () => {
      transport.close().catch(() => { });
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP ERROR:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `MCP listening on http://localhost:${PORT}`
  );
}); 