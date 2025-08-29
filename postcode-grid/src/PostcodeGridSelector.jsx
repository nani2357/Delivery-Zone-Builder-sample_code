import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, Circle, useMapEvents } from "react-leaflet";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
import { defaultMerchants } from "./merchants";

const STORAGE_KEY = "deliveryConfigV2";

const DISTRICT_FILES = [
  "CH1.geojson","CH2.geojson","CH3.geojson","CH4.geojson","CH5.geojson","CH6.geojson","CH7.geojson","CH8.geojson",
  "CH25.geojson","CH26.geojson","CH27.geojson","CH28.geojson","CH29.geojson","CH30.geojson","CH31.geojson","CH32.geojson","CH33.geojson","CH34.geojson",
  "CH41.geojson","CH42.geojson","CH43.geojson","CH44.geojson","CH45.geojson","CH46.geojson","CH47.geojson","CH48.geojson","CH49.geojson",
  "CH60.geojson","CH61.geojson","CH62.geojson","CH63.geojson","CH64.geojson","CH65.geojson","CH66.geojson","CH70.geojson","CH88.geojson","CH99.geojson",
  "L1.geojson","L2.geojson","L3.geojson","L4.geojson","L5.geojson","L6.geojson","L7.geojson","L8.geojson","L9.geojson",
  "L10.geojson","L11.geojson","L12.geojson","L13.geojson","L14.geojson","L15.geojson","L16.geojson","L17.geojson","L18.geojson","L19.geojson",
  "L20.geojson","L21.geojson","L22.geojson","L23.geojson","L24.geojson","L25.geojson","L26.geojson","L27.geojson","L28.geojson","L29.geojson",
  "L30.geojson","L31.geojson","L32.geojson","L33.geojson","L34.geojson","L35.geojson","L36.geojson","L37.geojson","L38.geojson","L39.geojson","L40.geojson",
  "L67.geojson","L68.geojson","L69.geojson","L70.geojson","L71.geojson","L72.geojson","L74.geojson","L75.geojson","L80.geojson"
];

const districtStyle = (isSelected) => ({
  color: isSelected ? "#111" : "#555",
  weight: isSelected ? 2 : 1,
  fillOpacity: isSelected ? 0.45 : 0.12,
});

function safeUnion(features) {
  if (!features || !features.length) return null;
  let acc = null;
  for (const f of features) {
    try { acc = acc ? turf.union(acc, f) : f; } catch { acc = acc || f; }
  }
  return acc;
}

function MapClick({ moveMode, onSetCenter }) {
  useMapEvents({
    click(e) {
      if (!moveMode) return;
      onSetCenter([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

export default function PostcodeGridSelector() {
  const [districts, setDistricts] = useState(null);
  useEffect(() => {
    Promise.all(
      DISTRICT_FILES.map((name) =>
        fetch("/" + name)
          .then((r) => (r.ok ? r.json() : null))
          .then((gj) => ({ name, gj }))
          .catch(() => null)
      )
    ).then((results) => {
      const features = [];
      for (const item of results) {
        if (!item || !item.gj) continue;
        const codeFromFile = item.name.replace(/\.geojson$/i, "").toUpperCase();

        if (item.gj.type === "FeatureCollection") {
          for (const f of item.gj.features || []) {
            const props = { ...(f.properties || {}), code: f.properties?.code || codeFromFile };
            features.push({ ...f, properties: props });
          }
        } else if (item.gj.type === "Feature") {
          const props = { ...(item.gj.properties || {}), code: item.gj.properties?.code || codeFromFile };
          features.push({ ...item.gj, properties: props });
        } else if (item.gj.type) {
          features.push({ type: "Feature", properties: { code: codeFromFile }, geometry: item.gj });
        }
      }
      setDistricts({ type: "FeatureCollection", features });
    });
  }, []);

  const [merchants, setMerchants] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : defaultMerchants;
  });
  const [activeId, setActiveId] = useState(() =>
    (defaultMerchants[0]?.id) || "merchant_1"
  );
  const [moveMode, setMoveMode] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merchants));
  }, [merchants]);

  useEffect(() => {
    if (!merchants.find((m) => m.id === activeId) && merchants[0]) {
      setActiveId(merchants[0].id);
    }
  }, [merchants, activeId]);

  const active = useMemo(
    () => merchants.find((m) => m.id === activeId) || merchants[0],
    [merchants, activeId]
  );

  const setActive = (patch) => {
    setMerchants((prev) => prev.map((m) => (m.id === active.id ? { ...m, ...patch } : m)));
  };

  // key parts for selection/state
  const allFeatures = districts?.features || [];
  const selectedSet = useMemo(() => new Set(active?.codes || []), [active?.codes]);

  const selectedFeatures = useMemo(() => {
    if (!districts) return [];
    return allFeatures.filter((f) => selectedSet.has(f.properties.code));
  }, [districts, selectedSet, allFeatures]);

  const radiusPoly = useMemo(() => {
    if (!active) return null;
    const pt = turf.point([active.center[1], active.center[0]]);
    return turf.buffer(pt, active.radiusMiles, { units: "miles" });
  }, [active?.center, active?.radiusMiles]);

  const mask = useMemo(() => {
    if (!selectedFeatures.length || !radiusPoly) return null;
    const clipped = [];
    for (const f of selectedFeatures) {
      try {
        const inter = turf.intersect(f, radiusPoly);
        if (inter) clipped.push(inter);
      } catch {}
    }
    if (!clipped.length) return null;
    return safeUnion(clipped) || turf.featureCollection(clipped);
  }, [selectedFeatures, radiusPoly]);

  // IMPORTANT: toggle takes explicit merchantId (avoid stale closure)
  const toggleCode = (code, merchantId) => {
    setMerchants((prev) =>
      prev.map((m) => {
        if (m.id !== merchantId) return m;
        const set = new Set(m.codes || []);
        set.has(code) ? set.delete(code) : set.add(code);
        return { ...m, codes: Array.from(set) };
      })
    );
  };

  const clearActive = () => setActive({ codes: [] });

  const resetToDefaults = () => {
    localStorage.removeItem(STORAGE_KEY);
    setMerchants(defaultMerchants);
    setActiveId(defaultMerchants[0]?.id || "merchant_1");
    setMoveMode(false);
  };

  const exportAll = () => {
    const out = merchants.map((m) => {
      const sel = allFeatures.filter((f) => (m.codes || []).includes(f.properties.code));
      const rp = turf.buffer(turf.point([m.center[1], m.center[0]]), m.radiusMiles, { units: "miles" });
      const clipped = sel.map((f) => { try { return turf.intersect(f, rp); } catch { return null; } }).filter(Boolean);
      const mMask = clipped.length ? (safeUnion(clipped) || turf.featureCollection(clipped)) : null;
      return { ...m, mask: mMask };
    });

    const blob = new Blob([JSON.stringify({ merchants: out }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "delivery_config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full h-full grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
      {/* MAP */}
      <div className="lg:col-span-2 rounded-2xl shadow p-2">
        <MapContainer
          center={active?.center || [53.405, -3.02]}
          zoom={12}
          scrollWheelZoom
          style={{ height: "70vh", width: "100%", borderRadius: "1rem" }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapClick moveMode={moveMode} onSetCenter={(latlng) => setActive({ center: latlng })} />

          {/* Make circle non-interactive so it doesn't eat polygon clicks */}
          {active && <Circle center={active.center} radius={active.radiusMiles * 1609.34} interactive={false} />}

          {/* Re-mount GeoJSON whenever active merchant changes */}
          {districts && (
            <GeoJSON
              key={activeId}  // <--- forces new handlers bound to current merchant
              data={districts}
              style={(f) => districtStyle(selectedSet.has(f.properties.code))}
              onEachFeature={(feature, layer) => {
                layer.on("click", (e) => {
                  e.originalEvent?.stopPropagation?.();
                  toggleCode(feature.properties.code, activeId); // <--- pass merchantId
                });
                layer.bindTooltip(feature.properties.code || "District");
              }}
            />
          )}

          {mask && (
            <GeoJSON data={mask} style={{ color: "#2563eb", weight: 2, fillOpacity: 0.15 }} />
          )}
        </MapContainer>
      </div>

      {/* SIDE PANEL */}
      <div className="rounded-2xl shadow p-4 space-y-4">
        <h2 className="text-xl font-semibold">Delivery Grid Builder (Multi-merchant)</h2>

        <div className="space-y-2">
          <label className="text-sm">Merchant</label>
          <select
            className="w-full border rounded p-2"
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm">Radius (miles) for “{active?.name}”</label>
          <input
            type="range"
            min={0}
            max={15}
            step={0.5}
            value={active?.radiusMiles || 0}
            onChange={(e) => setActive({ radiusMiles: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="text-sm">Current: {active?.radiusMiles?.toFixed(1)} miles</div>

          <label className="inline-flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={moveMode}
              onChange={(e) => setMoveMode(e.target.checked)}
            />
            Move center by clicking map
          </label>
          <div className="text-xs text-gray-600">When OFF, clicking polygons selects/deselects districts.</div>
        </div>

        <div>
          <h3 className="font-medium mb-2">Allowed districts for “{active?.name}”</h3>
          {(active?.codes || []).length === 0 ? (
            <div className="text-sm text-gray-600">None selected. Click polygons on the map.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(active?.codes || []).map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCode(c, activeId)}
                  className="px-2 py-1 rounded-full text-sm bg-gray-100 hover:bg-gray-200"
                >
                  {c} ✕
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={exportAll} className="px-3 py-2 rounded-xl shadow bg-black text-white">
            Export config (all merchants)
          </button>
          <button onClick={clearActive} className="px-3 py-2 rounded-xl shadow bg-gray-100">
            Clear active selection
          </button>
          <button onClick={resetToDefaults} className="px-3 py-2 rounded-xl shadow bg-gray-100">
            Reset to merchants.js
          </button>
        </div>

        <div className="text-xs text-gray-500">
          Config saves to <code>{STORAGE_KEY}</code> in localStorage.
        </div>
      </div>
    </div>
  );
}
