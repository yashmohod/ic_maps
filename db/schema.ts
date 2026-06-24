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
    node_outside_id: integer("node_outside_id").references(
      () => nodeOutside.id,
      {
        onDelete: "cascade",
      },
    ),
    parent_node_inside_id: integer("parent_node_inside_id"),

    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    is_entry: boolean("is_entry").notNull().default(false),
    is_exit: boolean("is_exit").notNull().default(false),
    is_elevator: boolean("is_elevator").notNull().default(false),
    is_stairs: boolean("is_stairs").notNull().default(false),
    is_ramp: boolean("is_ramp").notNull().default(false),
    is_group: boolean("is_group").notNull().default(false),
    is_dead: boolean("is_dead").notNull().default(false),
    image_url: text("image_url"),
    incline: doublePrecision("incline").default(0),
    width: doublePrecision("width"),
    height: doublePrecision("height"),
    name: text("name"),

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
    is_dead: boolean("is_dead").notNull().default(false),

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

// outageLog
export const outageLog = pgTable("outage_log", {
  id: serial("id").primaryKey(),
  datetime: timestamp("datetime", {
    precision: 6,
    withTimezone: true,
  }).defaultNow(),
  inside_node: boolean("inside_node").notNull().default(false),
  node_id: integer("node_id").notNull(),
  note: text("note").default(""),
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
    name: varchar("name", { length: 256 }).notNull(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    description: text("description"),
  },
  (t) => [unique("route_user_name_unique").on(t.user_id, t.name)],
);

export const route_destination = pgTable(
  "route_destination",
  {
    order: integer("order").notNull(),
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    route_id: integer("route_id")
      .notNull()
      .references(() => route.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.route_id, t.destination_id] })],
);

export const route_parking_lot = pgTable(
  "route_parking_lot",
  {
    route_id: integer("route_id")
      .notNull()
      .references(() => route.id, { onDelete: "cascade" }),
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.route_id, t.destination_id] })],
);

// Relations for route ↔ route_destination ↔ destination
export const routeRelations = relations(route, ({ one, many }) => ({
  user: one(user, { fields: [route.user_id], references: [user.id] }),
  route_destinations: many(route_destination),
  route_parking_lots: many(route_parking_lot),
}));

export const routeDestinationRelations = relations(
  route_destination,
  ({ one }) => ({
    route: one(route, {
      fields: [route_destination.route_id],
      references: [route.id],
    }),
    destination: one(destination, {
      fields: [route_destination.destination_id],
      references: [destination.id],
    }),
  }),
);

export const destinationRelations = relations(destination, ({ many }) => ({
  route_destinations: many(route_destination),
  route_parking_lots: many(route_parking_lot),
}));

export const routeParkingLotRelations = relations(
  route_parking_lot,
  ({ one }) => ({
    route: one(route, {
      fields: [route_parking_lot.route_id],
      references: [route.id],
    }),
    destination: one(destination, {
      fields: [route_parking_lot.destination_id],
      references: [destination.id],
    }),
  }),
);

export const user_favorite_destination = pgTable(
  "user_favorite_destination",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.destination_id] })],
);

export const destination_chain = pgTable(
  "destination_chain",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    created_at: timestamp("created_at", { mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("destination_chain_user_name_unique").on(t.user_id, t.name)],
);

export const destination_chain_stop = pgTable(
  "destination_chain_stop",
  {
    chain_id: integer("chain_id")
      .notNull()
      .references(() => destination_chain.id, { onDelete: "cascade" }),
    destination_id: integer("destination_id")
      .notNull()
      .references(() => destination.id, { onDelete: "cascade" }),
    sort_order: integer("sort_order").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.sort_order] })],
);

export const userFavoriteDestinationRelations = relations(
  user_favorite_destination,
  ({ one }) => ({
    user: one(user, {
      fields: [user_favorite_destination.user_id],
      references: [user.id],
    }),
    destination: one(destination, {
      fields: [user_favorite_destination.destination_id],
      references: [destination.id],
    }),
  }),
);

export const destinationChainRelations = relations(
  destination_chain,
  ({ one, many }) => ({
    user: one(user, {
      fields: [destination_chain.user_id],
      references: [user.id],
    }),
    stops: many(destination_chain_stop),
  }),
);

export const destinationChainStopRelations = relations(
  destination_chain_stop,
  ({ one }) => ({
    chain: one(destination_chain, {
      fields: [destination_chain_stop.chain_id],
      references: [destination_chain.id],
    }),
    destination: one(destination, {
      fields: [destination_chain_stop.destination_id],
      references: [destination.id],
    }),
  }),
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

export const bugReport = pgTable("bug_report", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  photo_path: text("photo_path"),
  created_at: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accessibilityReport = pgTable("accessibility_report", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  photo_path: text("photo_path"),
  created_at: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  user_id: text("user_id").references(() => user.id, { onDelete: "set null" }),
});

export const routeReport = pgTable("route_report", {
  id: serial("id").primaryKey(),
  text: text("text"),
  location_type: varchar("location_type", { length: 32 }).notNull(),
  destination_id: integer("destination_id").references(() => destination.id, {
    onDelete: "set null",
  }),
  feature_type: varchar("feature_type", { length: 32 }),
  node_outside_id: integer("node_outside_id").references(() => nodeOutside.id, {
    onDelete: "set null",
  }),
  node_inside_id: integer("node_inside_id").references(() => nodeInside.id, {
    onDelete: "set null",
  }),
  pin_lat: doublePrecision("pin_lat"),
  pin_lng: doublePrecision("pin_lng"),
  created_at: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  user_id: text("user_id").references(() => user.id, { onDelete: "set null" }),
});

export const schema = {
  user,
  session,
  account,
  verification,
  nodeOutside,
  nodeInside,
  edgeInside,
  edgeOutside,
  destination,
  route,
  route_destination,
  route_parking_lot,
  destinationNode,
  user_favorite_destination,
  destination_chain,
  destination_chain_stop,
  bugReport,
  accessibilityReport,
  routeReport,
};
export type User = InferSelectModel<typeof user>;
export type NodeOutside = InferSelectModel<typeof nodeOutside>;
export type NodeInside = InferSelectModel<typeof nodeInside>;
export type EdgeOutside = InferSelectModel<typeof edgeOutside>;
export type EdgeInside = InferSelectModel<typeof edgeInside>;

export type Destination = InferSelectModel<typeof destination>;
export type Route = InferSelectModel<typeof route>;
export type RouteDestination = InferSelectModel<typeof route_destination>;
export type RouteParkingLot = InferSelectModel<typeof route_parking_lot>;
export type DestinationNode = InferSelectModel<typeof destinationNode>;
export type UserFavoriteDestination = InferSelectModel<
  typeof user_favorite_destination
>;
export type DestinationChain = InferSelectModel<typeof destination_chain>;
export type DestinationChainStop = InferSelectModel<
  typeof destination_chain_stop
>;
export type BugReport = InferSelectModel<typeof bugReport>;
export type AccessibilityReport = InferSelectModel<typeof accessibilityReport>;
export type RouteReport = InferSelectModel<typeof routeReport>;
