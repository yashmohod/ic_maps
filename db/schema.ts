import { relations, InferSelectModel } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  serial,
  doublePrecision,
  geometry,
  varchar,
  integer,
  unique,
  primaryKey,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),

  name: text("name").notNull(),
  email: text("email").notNull().unique(),

  isAdmin: boolean("is_admin").notNull().default(false),
  isRouteManager: boolean("is_route_manager").notNull().default(false),

  emailVerified: boolean("email_verified").notNull().default(false),

  image: text("image"),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),

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

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),

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

    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),

    scope: text("scope"),
    password: text("password"),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),

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

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),

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

//nodes type
export const nodeType = pgTable("node_type", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull().unique(),
});

//nodes
export const node = pgTable(
  "node",
  {
    id: serial("id").primaryKey(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    nodeType: integer("node_type")
      .notNull()
      .references(() => nodeType.id, { onDelete: "restrict" }),

    blueLight: boolean("blue_light").notNull().default(false),

    // PostGIS point: x = lng, y = lat
    location: geometry("location", {
      type: "point",
      mode: "xy",
      srid: 4326,
    }).notNull(),
  },
  (t) => [
    // spatial index for fast nearest/within queries
    index("node_location_gist").using("gist", t.location),
  ],
);

//edges
export const edge = pgTable(
  "edge",
  {
    id: serial("id").primaryKey(),
    nodeAId: integer("node_a_id")  // min
      .notNull()
      .references(() => node.id, { onDelete: "cascade" }),
    nodeBId: integer("node_b_id")  // max
      .notNull()
      .references(() => node.id, { onDelete: "cascade" }),
    biDirectional: boolean("bi_directional").notNull().default(true),
    direction: boolean("direction").notNull().default(true), // true a -> b; false b -> a
    distance: doublePrecision("distance").notNull(), // meters

  },
  (t) => [
    unique("edge_pair_unique").on(t.nodeAId, t.nodeBId),
    index("idx_edge_a").on(t.nodeAId),
    index("idx_edge_b").on(t.nodeBId),
  ],
);

//navmodes
export const navMode = pgTable("nav_mode", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull().unique(),
  throughBuilding: boolean("through_building").notNull().default(false),
});

//buildings
export const destination = pgTable("destination", {
  id: serial("id").primaryKey(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  name: varchar("name", { length: 256 }).notNull().unique(),
  polygon: text("polygon"),
});

//routes
export const route = pgTable(
  "route",
  {
    id: serial("id").primaryKey(),
    destinationId: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    description: text("description"),
  },
  (t) => [unique("route_user_name_unique").on(t.userId, t.name)],
);

//join table: edge <-> navmode
export const edgeNavMode = pgTable(
  "edge_nav_mode",
  {
    edgeId: integer("edge_id")
      .notNull()
      .references(() => edge.id, { onDelete: "cascade" }),
    navModeId: integer("nav_mode_id")
      .notNull()
      .references(() => navMode.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.edgeId, t.navModeId] }),
    index("idx_edge_nav_mode_edge").on(t.edgeId),
    index("idx_edge_nav_mode_mode").on(t.navModeId),
  ],
);

//join table: destination <-> nodes
export const destinationNode = pgTable(
  "destination_node",
  {
    destinationId: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    nodeId: integer("node_id")
      .notNull()
      .references(() => node.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.destinationId, t.nodeId] }),
    index("idx_destination_node_dest").on(t.destinationId),
    index("idx_destination_node_node").on(t.nodeId),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  nodeType,
  node,
  edge,
  navMode,
  destination,
  route,
  edgeNavMode,
  destinationNode,
};
export type User = InferSelectModel<typeof user>;
export type NodeType = InferSelectModel<typeof nodeType>;
export type Node = InferSelectModel<typeof node>;
export type Edge = InferSelectModel<typeof edge>;
export type NavMode = InferSelectModel<typeof navMode>;
export type Destination = InferSelectModel<typeof destination>;
export type Route = InferSelectModel<typeof route>;
export type EdgeNavMode = InferSelectModel<typeof edgeNavMode>;
export type DestinationNode = InferSelectModel<typeof destinationNode>;
