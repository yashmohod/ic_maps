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
  foreignKey,
  time,
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

export const nodeInside = pgTable(
  "node_inside",
  {
    id: serial("id").primaryKey(),
    node_outside_id: integer("node_outside_id").references(() => nodeOutside.id, {
      onDelete: "cascade",
    }),
    parent_node_inside_id: integer("parent_node_inside_id"),

    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    is_entry: boolean("is_entry").notNull().default(false),
    is_exit: boolean("is_exit").notNull().default(false),
    is_elevator: boolean("is_elevator").notNull().default(false),
    is_stairs: boolean("is_stairs").notNull().default(false),
    is_ramp: boolean("is_ramp").notNull().default(false),
    is_group: boolean("is_group").notNull().default(false),
    image_url: text("image_url"),
    incline: doublePrecision("incline"),
    width: doublePrecision("width"),
    height: doublePrecision("height"),

    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("node_inside_destination_id_idx").on(t.destination_id),
    index("node_inside_parent_idx").on(t.parent_node_inside_id),
    foreignKey({
      columns: [t.parent_node_inside_id],
      foreignColumns: [t.id],
      name: "node_inside_parent_fk",
    }).onDelete("set null"),
  ],
);

//edges inside
export const edgeInside = pgTable(
  "edge_inside",
  {
    id: serial("id").primaryKey(),
    node_a_id: integer("node_a_id") // min
      .notNull()
      .references(() => nodeInside.id, { onDelete: "cascade" }),
    node_b_id: integer("node_b_id") // max
      .notNull()
      .references(() => nodeInside.id, { onDelete: "cascade" }),

    bi_directional: boolean("bi_directional").notNull().default(true),
    direction: boolean("direction").notNull().default(true), // true a -> b; false b -> a
    source_handle: text("source_handle"), // which handle on source node: top | right | bottom | left
    target_handle: text("target_handle"), // which handle on target node

    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("edge_inside_pair_unique").on(t.node_a_id, t.node_b_id),
    index("idx_edge_inside_a").on(t.node_a_id),
    index("idx_edge_inside_b").on(t.node_b_id),
    index("edge_inside_destination_id_idx").on(t.destination_id),
  ],
);

//nodes outside
export const nodeOutside = pgTable(
  "node_outside",
  {
    id: serial("id").primaryKey(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),

    // nav mode
    is_pedestrian: boolean("is_pedestrian").notNull().default(false),
    is_vehicular: boolean("is_vehicular").notNull().default(false),
    is_elevator: boolean("is_elevator").notNull().default(false),
    is_stairs: boolean("is_stairs").notNull().default(false),
    is_blue_light: boolean("is_blue_light").notNull().default(false),

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

//edges outside
export const edgeOutside = pgTable(
  "edge_outside",
  {
    id: serial("id").primaryKey(),
    node_a_id: integer("node_a_id") // min
      .notNull()
      .references(() => nodeOutside.id, { onDelete: "cascade" }),
    node_b_id: integer("node_b_id") // max
      .notNull()
      .references(() => nodeOutside.id, { onDelete: "cascade" }),

    // direction
    bi_directional: boolean("bi_directional").notNull().default(true),
    direction: boolean("direction").notNull().default(true), // true a -> b; false b -> a
    distance: doublePrecision("distance").notNull(), // meters
    incline: doublePrecision("incline").notNull().default(0), // meters
  },
  (t) => [
    unique("edge_outside_pair_unique").on(t.node_a_id, t.node_b_id),
    index("idx_edge_outside_a").on(t.node_a_id),
    index("idx_edge_outside_b").on(t.node_b_id),
  ],
);

//navmodes
export const navMode = pgTable("nav_mode", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull().unique(),
  through_building: boolean("through_building").notNull().default(false),
});

//buildings
export const destination = pgTable("destination", {
  id: serial("id").primaryKey(),
  lat: doublePrecision("lat").notNull().default(0),
  lng: doublePrecision("lng").notNull().default(0),
  name: varchar("name", { length: 256 }).notNull().unique(),
  polygon: text("polygon").default(""),
  is_parking_lot: boolean("is_parking_lot").notNull().default(false),
  open_time: time("open_time", { precision: 6, withTimezone: true })
    .notNull()
    .default("00:00:00"),
  close_time: time("close_time", { precision: 6, withTimezone: true })
    .notNull()
    .default("23:59:59"),
});

//routes
export const route = pgTable(
  "route",
  {
    id: serial("id").primaryKey(),
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    description: text("description"),
  },
  (t) => [unique("route_user_name_unique").on(t.user_id, t.name)],
);

//join table: destination <-> nodes
export const destinationNode = pgTable(
  "destination_node",
  {
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    node_outside_id: integer("node_outside_id")
      .notNull()
      .references(() => nodeOutside.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.destination_id, t.node_outside_id] }),
    index("destination_node_destination_id_idx").on(t.destination_id),
    index("destination_node_node_outside_id_idx").on(t.node_outside_id),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  nodeOutside,
  nodeInside,
  edgeInside,
  edgeOutside,
  navMode,
  destination,
  route,
  destinationNode,
};
export type User = InferSelectModel<typeof user>;
export type NodeOutside = InferSelectModel<typeof nodeOutside>;
export type NodeInside = InferSelectModel<typeof nodeInside>;
export type EdgeOutside = InferSelectModel<typeof edgeOutside>;
export type EdgeInside = InferSelectModel<typeof edgeInside>;
export type NavMode = InferSelectModel<typeof navMode>;
export type Destination = InferSelectModel<typeof destination>;
export type Route = InferSelectModel<typeof route>;
export type DestinationNode = InferSelectModel<typeof destinationNode>;
