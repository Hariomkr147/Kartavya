import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@/components/ui/Label";
import {
  LAYER_KEYS,
  LAYER_LABELS,
  type ZoneMapLayerKey,
  type ZoneMapLayerState,
} from "@/lib/zoneMapLayers";

/** The layer switches above the map. Presentational — the state lives in `useZoneMapLayers`. */
export function ZoneMapLayerToggles({
  layers,
  onToggle,
}: {
  layers: ZoneMapLayerState;
  onToggle: (key: ZoneMapLayerKey) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex-1">
      <Label id="map-layers-label">{t("zoneMap.layers")}</Label>
      <div
        role="group"
        aria-labelledby="map-layers-label"
        className="flex flex-wrap gap-x-5 gap-y-2"
      >
        {LAYER_KEYS.map((key) => (
          <Checkbox
            key={key}
            checked={layers[key]}
            onChange={() => onToggle(key)}
            label={t(LAYER_LABELS[key])}
          />
        ))}
      </div>
    </div>
  );
}
