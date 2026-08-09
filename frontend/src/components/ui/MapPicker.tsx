import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { MapSearchBox } from "@/components/ui/MapSearchBox";

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
  /** Show the place/landmark search box above the map. */
  searchable?: boolean;
  searchPlaceholder?: string;
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

/** Fly to a searched place. Separate from RecenterOnValue, which holds the
 *  current zoom — picking a landmark should also zoom in to street level. */
function FlyToTarget({ target }: { target: (LatLng & { zoom: number }) | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo({ lat: target.lat, lng: target.lng }, target.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
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
  searchable = true,
  searchPlaceholder,
}: MapPickerProps) {
  const [flyTarget, setFlyTarget] = useState<(LatLng & { zoom: number }) | null>(null);

  return (
    <div className="space-y-2">
      {searchable && (
        <MapSearchBox
          placeholder={searchPlaceholder}
          // Bias towards the pin, or the map's starting point before one exists.
          near={value ?? defaultCenter}
          onSelect={(place) => {
            onChange({ lat: place.lat, lng: place.lng });
            setFlyTarget({ lat: place.lat, lng: place.lng, zoom: 16 });
          }}
        />
      )}
      <div
        className={cn(
          "relative isolate overflow-hidden rounded-md border border-line",
          className,
        )}
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
        <FlyToTarget target={flyTarget} />
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
    </div>
  );
}
