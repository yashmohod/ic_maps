import { relations, InferSelectModel } from "drizzle-orm";
import { pgTable, text, boolean, timestamp, index, serial,doublePrecision } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),

  name: text("name").notNull(),
  email: text("email").notNull().unique(),

  isAdmin: boolean("is_admin").notNull().default(false),
  isRouteManager: boolean("is_route_manager").notNull().default(false),

  emailVerified: boolean("email_verified").notNull().default(false),

  image: text("image"),

  createdAt: timestamp("created_at", { mode: "date" })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),

    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),

    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),

    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),

    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date" }),

    scope: text("scope"),
    password: text("password"),

    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),

    identifier: text("identifier").notNull(),
    value: text("value").notNull(),

    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

    createdAt: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));




//nodes
export const nodes = pgtable('nodes',{
  id:serial().primaryKey(),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
})


//edges
//navmodes
//buildings
//routes
















export const schema = { user, session, account, verification };

export type User = InferSelectModel<typeof user>;
