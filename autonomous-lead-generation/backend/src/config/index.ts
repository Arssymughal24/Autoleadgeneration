import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000"),
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: "gpt-4",
  },
  salesforce: {
    username: process.env.SALESFORCE_USERNAME || "",
    password: process.env.SALESFORCE_PASSWORD || "",
    token: process.env.SALESFORCE_TOKEN || "",
    sandbox: process.env.SALESFORCE_SANDBOX === "true",
  },
  jwt: {
    secret: process.env.JWT_SECRET || "default-secret",
    expiresIn: "24h",
  },
  leadSources: {
    uplead: {
      apiKey: process.env.UPLEAD_API_KEY || "",
      baseUrl: "https://api.uplead.com/v2",
    },
    zoominfo: {
      apiKey: process.env.ZOOMINFO_API_KEY || "",
      baseUrl: "https://api.zoominfo.com",
    },
  },
  notifications: {
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    },
    email: process.env.NOTIFICATION_EMAIL || "",
  },
};
