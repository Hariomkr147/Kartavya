import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";

// Vite rewrites these image imports to hashed URLs; Leaflet's default icon
// otherwise resolves marker images against relative paths that break under
// any bundler, so the default icon must be re-pointed explicitly like this.
const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  defaultCenter?: LatLng;
  zoom?: number;
  className?: string;
  height?: number;
}

const BENGALURU_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };

function ClickHandler({ onChange }: { onChange: (value: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function RecenterButton({ onLocate }: { onLocate: (value: LatLng) => void }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => {
        navigator.geolocation?.getCurrentPosition((position) => {
          const next = { lat: position.coords.latitude, lng: position.coords.longitude };
          onLocate(next);
          map.flyTo(next, 15);
        });
      }}
      title="Use my current location"
      aria-label="Use my current location"
      className="absolute top-2 right-2 z-[1000] inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-muted shadow-sm hover:text-ink"
    >
      <LocateFixed className="size-4" aria-hidden="true" />
    </button>
  );
}

function RecenterOnValue({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.setView(value, map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);
  return null;
}

/** Bespoke click/drag map picker built on Leaflet + OpenStreetMap tiles — no API key. */
export function MapPicker({
  value,
  onChange,
  defaultCenter = BENGALURU_CENTER,
  zoom = 13,
  className,
  height = 320,
}: MapPickerProps) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-md border border-line", className)}
      style={{ height }}
    >
      <MapContainer
        center={value ?? defaultCenter}
        zoom={zoom}
        className="size-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onChange={onChange} />
        <RecenterOnValue value={value} />
        {value && (
          <Marker
            position={value}
            icon={defaultIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                onChange({ lat: pos.lat, lng: pos.lng });
              },
            }}
          />
        )}
        <RecenterButton onLocate={onChange} />
      </MapContainer>
    </div>
  );
}
