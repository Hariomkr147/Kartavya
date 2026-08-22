import type { ReactNode } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { cn } from "@/lib/utils";

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/**
 * A cluster's centroid is not a place anyone reported — it is the average of
 * the places they did. Drawing it with the same teardrop as a real complaint
 * is what made a twelve-report cluster read as one pin, so it gets a marker
 * that cannot be mistaken for one: a hollow brand-coloured ring, sized to sit
 * behind the member pins rather than compete with them.
 */
const centroidIcon = L.divIcon({
  className: "",
  html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;border:3px solid var(--color-brand);background:color-mix(in oklab, var(--color-brand) 20%, transparent);box-shadow:0 0 0 2px rgba(0,0,0,.15)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -10],
});

export interface MiniMapPin {
  id: string;
  lat: number;
  lng: number;
  /** Plain-text popup. Ignored when `popup` is given. */
  label?: string;
  /** Popup content when a plain string is not enough — e.g. a link to the complaint. */
  popup?: ReactNode;
  /** `centroid` marks a derived point (a cluster average), not a reported one. */
  variant?: "default" | "centroid";
}

export interface MiniMapProps {
  pins: MiniMapPin[];
  height?: number;
  zoom?: number;
  className?: string;
  onPinClick?: (id: string) => void;
}

function boundsFor(pins: MiniMapPin[]): L.LatLngBoundsExpression {
  return pins.map((p) => [p.lat, p.lng] as [number, number]);
}

/**
 * Read-only Leaflet display of one or more already-known coordinates — no
 * click-to-set, no drag, no geolocation button (that's `MapPicker`'s job).
 * Renders whatever `latitude`/`longitude` the current page already fetched;
 * never triggers a new network request of its own beyond the same
 * OpenStreetMap tile layer `MapPicker` already uses elsewhere in the app.
 */
export function MiniMap({
  pins,
  height = 220,
  zoom = 15,
  className,
  onPinClick,
}: MiniMapProps) {
  if (pins.length === 0) return null;
  const single = pins.length === 1;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-md border border-line",
        className,
      )}
      style={{ height }}
    >
      <MapContainer
        center={single ? [pins[0].lat, pins[0].lng] : undefined}
        bounds={!single ? boundsFor(pins) : undefined}
        boundsOptions={{ padding: [24, 24] }}
        zoom={single ? zoom : undefined}
        className="size-full"
        scrollWheelZoom={false}
        dragging
        attributionControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={pin.variant === "centroid" ? centroidIcon : defaultIcon}
            zIndexOffset={pin.variant === "centroid" ? -100 : 0}
            eventHandlers={onPinClick ? { click: () => onPinClick(pin.id) } : undefined}
          >
            {(pin.popup ?? pin.label) && <Popup>{pin.popup ?? pin.label}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
