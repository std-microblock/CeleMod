import { THEME_REGISTRY, type ThemeId } from "../themes/registry";
import { Icon } from "./Icon";
import "./ThemePicker.scss";

export interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  compact?: boolean;
}

/** Theme selector with visual previews. Kept presentational so it can be
 * embedded in Settings or a dedicated appearance page. */
export const ThemePicker = ({
  value,
  onChange,
  compact = false,
}: ThemePickerProps) => (
  <div
    className={`theme-picker${compact ? " compact" : ""}`}
    role="radiogroup"
    aria-label="Theme"
  >
    {THEME_REGISTRY.map((theme) => (
      <button
        key={theme.id}
        type="button"
        role="radio"
        aria-checked={value === theme.id}
        className={`theme-option${value === theme.id ? " selected" : ""}`}
        onClick={() => onChange(theme.id as ThemeId)}
      >
        <img src={theme.preview} alt="" loading="lazy" />
        <span className="theme-option-copy">
          <strong>{theme.name}</strong>
        </span>
        {value === theme.id && (
          <span className="theme-option-check" aria-hidden="true">
            <Icon name="i-tick" />
          </span>
        )}
      </button>
    ))}
  </div>
);
