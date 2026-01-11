// src/lib/icmapsApi.ts
// Client-side API wrapper that calls your Next.js proxy routes under /api/*
//
// Assumes you created matching Next routes like:
// - /api/map, /api/map/bluelight, /api/map/navigateTo
// - /api/building, /api/building/nodesget, /api/building/nodeadd, /api/building/noderemove,
//   /api/building/setpolygon, /api/building/buildingpos
// - /api/navmode, /api/navmode/setstatus, /api/navmode/allids, /api/navmode/all
//
// If you don't have those routes yet, create them and forward to your backend.

import apiClient from "./apiClient";

/** -----------------------------
 *  user (Account) functions
 *  ----------------------------- */

export const getUser = async (id: string) => {
  // old: GET /building/nodesget?id=...
  return apiClient.get(`/api/user?id=${encodeURIComponent(id)}`);
};

/** -----------------------------
 *  Editor (Map) functions
 *  ----------------------------- */

export const getAllMapFeature = async () => {
  // old: GET /map/all
  return apiClient.get("/api/map/all"); // make /api/map (GET) forward to BACKEND /map/all
};

export const addNode = async (id: string, lng: number, lat: number) => {
  // old: POST /map/ { id, lng, lat, type:"node" }
  await apiClient.post("/api/map", { id, lng, lat, type: "node" });
  return true;
};

export const editNode = async (id: string, lng: number, lat: number) => {
  // old: PUT /map/ { id, lng, lat }
  await apiClient.put("/api/map", { id, lng, lat });
  return true;
};

export const setBlueLight = async (nodeId: string, isBlueLight: boolean) => {
  // old: POST /map/bluelight
  await apiClient.post("/api/map/bluelight", { nodeId, isBlueLight });
  return true;
};

export const addEdge = async (
  key: string,
  to: string,
  from: string,
  biDirectional: boolean,
) => {
  // old: POST /map/ { key, to, from, type:"edge", biDirectional }
  await apiClient.post("/api/map", {
    key,
    to,
    from,
    type: "edge",
    biDirectional,
  });
  return true;
};

export const deleteFeature = async (
  featureKey: string,
  featureType: string,
) => {
  // old: DELETE /map/ with axios { data: {...} }
  await apiClient.del("/api/map", { featureKey, featureType });
  return true;
};

/** -----------------------------
 *  Building functions
 *  ----------------------------- */

export const addBuilding = async (
  id: string,
  name: string,
  lat: number,
  lng: number,
  polyGon: any,
) => {
  // old: POST /building/
  return apiClient.post("/api/building", { id, name, lat, lng, polyGon });
};

export const editBuildingName = async (id: string, name: string) => {
  // old: PUT /building/
  return apiClient.put("/api/building", { id, name });
};

export const deleteBuilding = async (id: string) => {
  // old: DELETE /building/ { id }
  return apiClient.del("/api/building", { id });
};

export const getAllBuildings = async () => {
  // old: GET /building/
  return apiClient.get("/api/building");
};

export const getAllBuildingNodes = async (id: string) => {
  // old: GET /building/nodesget?id=...
  return apiClient.get(`/api/building/nodesget?id=${encodeURIComponent(id)}`);
};

export const attachNodeToBuilding = async (
  buildingId: string,
  nodeId: string,
) => {
  // old: POST /building/nodeadd
  await apiClient.post("/api/building/nodeadd", { buildingId, nodeId });
  return true;
};

export const detachNodeFromBuilding = async (
  buildingId: string,
  nodeId: string,
) => {
  // old: POST /building/noderemove
  await apiClient.post("/api/building/noderemove", { buildingId, nodeId });
  return true;
};

export const updateBuildingPolyGon = async (
  buildingId: string,
  polygonJson: any,
  lat: number,
  lng: number,
) => {
  // old: PATCH /building/setpolygon
  return apiClient.patch("/api/building/setpolygon", {
    buildingId,
    polygonJson,
    lat,
    lng,
  });
};

export const removeBuildingPolyGon = async (buildingId: string) => {
  // old: DELETE /building/setpolygon { buildingId }
  return apiClient.del("/api/building/setpolygon", { buildingId });
};

export const getBuildingPos = async (buildingId: string) => {
  // old: GET /building/buildingpos?id=...
  return apiClient.get(
    `/api/building/buildingpos?id=${encodeURIComponent(buildingId)}`,
  );
};

/** -----------------------------
 *  NavMode functions
 *  ----------------------------- */

export const addNavMode = async (name: string, fromThrough: boolean) => {
  // old: POST /navmode/
  return apiClient.post("/api/navmode", { name, fromThrough });
};

export const editNavMode = async (
  id: string,
  name: string,
  fromThrough: boolean,
) => {
  // old: PUT /navmode/
  return apiClient.put("/api/navmode", { id, name, fromThrough });
};

export const deleteNavMode = async (id: string) => {
  // old: DELETE /navmode/ { id }
  return apiClient.del("/api/navmode", { id });
};

export const getAllNavModes = async () => {
  // old: GET /navmode/
  return apiClient.get("/api/navmode");
};

export const setNavModeStatus = async (
  id: string,
  value: boolean | number | string,
  featureType: string,
  navModeId: string,
) => {
  // old: PATCH /navmode/setstatus
  await apiClient.patch("/api/navmode/setstatus", {
    id,
    value,
    featureType,
    navModeId,
  });
  return true;
};

export const getAllMapFeaturesNavModeIds = async (navModeId: string) => {
  // old: GET /navmode/allids?navModeId=...
  return apiClient.get(
    `/api/navmode/allids?navModeId=${encodeURIComponent(navModeId)}`,
  );
};

export const getAllMapFeaturesNavMode = async (navModeId: string) => {
  // old: GET /navmode/all?navModeId=...
  return apiClient.get(
    `/api/navmode/all?navModeId=${encodeURIComponent(navModeId)}`,
  );
};

/** -----------------------------
 *  Navigation / vehicular functions
 *  ----------------------------- */

export const getRouteTo = async (
  buildingId: string,
  lat: number,
  lng: number,
  navMode: string,
) => {
  // old: GET /map/navigateTo?id=...&lat=...&lng=...&navMode=...
  const qs =
    `id=${encodeURIComponent(buildingId)}` +
    `&lat=${encodeURIComponent(String(lat))}` +
    `&lng=${encodeURIComponent(String(lng))}` +
    `&navMode=${encodeURIComponent(navMode)}`;

  return apiClient.get(`/api/map/navigateTo?${qs}`);
};

export const getNearestBlueLightPath = async (lat: number, lng: number) => {
  // old: GET /map/bluelight?lat=...&lng=...
  return apiClient.get(
    `/api/map/bluelight?lat=${encodeURIComponent(
      String(lat),
    )}&lng=${encodeURIComponent(String(lng))}`,
  );
};

/** -----------------------------
 *  Shareable Routes
 *  ----------------------------- */

export const getAllUserRoutes = async (userId: string) => {
  return apiClient.get(
    `/api/shareableroute/all?userId=${encodeURIComponent(userId)}`,
  );
};

export const AddRoute = async (
  userId: string,
  routeName: string,
  destinationId: string,
) => {
  return apiClient.post("/api/shareableroute/", {
    userId,
    routeName,
    destinationId,
  });
};

export const EditRoute = async (
  routeId: number,
  routeName: string,
  destinationId: string,
) => {
  return apiClient.put("/api/shareableroute", {
    routeId,
    routeName,
    destinationId,
  });
};

export const DeleteRoute = async (routeId: number) => {
  // old: DELETE /navmode/ { id }
  return apiClient.del("/api/shareableroute", { routeId });
};

export const RouteNavigate = async (
  routeId: number,
  userLat: number,
  userLng: number,
  navModeId: number,
) => {
  return apiClient.get(
    `/api/shareableroute/navigate?lat=${encodeURIComponent(
      String(userLat),
    )}&lng=${encodeURIComponent(
      String(userLng)
    )}&routeId=${encodeURIComponent(
      String(routeId)
    )}&lng=${encodeURIComponent(
      String(navModeId)
    )}`,
  );
};
