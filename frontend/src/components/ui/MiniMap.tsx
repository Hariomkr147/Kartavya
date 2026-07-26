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

export interface MiniMapPin {
  id: string;
  lat: number;
  lng: number;
  label?: string;
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
            icon={defaultIcon}
            eventHandlers={onPinClick ? { click: () => onPinClick(pin.id) } : undefined}
          >
            {pin.label && <Popup>{pin.label}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
