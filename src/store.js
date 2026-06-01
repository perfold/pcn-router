// zustand store
import { create } from "zustand";

export const useStore = create((set) => ({
  waypoints: [], // { id, nodeId, lngLat, label }
  totalDistanceM: null,
  routeCoords: null, // flat coord array for gpx export

  setWaypoints: (wps) => set({ waypoints: wps }),
  setTotalDistanceM: (d) => set({ totalDistanceM: d }),
  setRouteCoords: (coords) => set({ routeCoords: coords }),

  addWaypoint: (wp) => set((s) => ({ waypoints: [...s.waypoints, wp] })),
  removeWaypoint: (id) =>
    set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) })),
}));
