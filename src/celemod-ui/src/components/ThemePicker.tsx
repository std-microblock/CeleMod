import { THEME_REGISTRY, type ThemeId } from "../themes/registry";
import { Icon } from "./Icon";
import "./ThemePicker.scss";

export interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  compact?: boolean;
}

const ThemeMiniPreview = ({ id }: { id: ThemeId }) => (
  <span
    className={`theme-preview-stage theme-preview-${id}`}
    aria-hidden="true"
  >
    <span className="tp-window">
      <span className="tp-titlebar">
        {id === "material-you" && <span className="tp-brand-dot" />}
        <span className="tp-title-bar" />
        <span className="tp-win-controls">
          <span />
          <span />
        </span>
      </span>
      <span className="tp-body">
        <span className="tp-sidebar">
          <span className="tp-nav is-active">
            <span className="tp-nav-ico" />
            {id === "fluent" && <span className="tp-nav-label" />}
          </span>
          <span className="tp-nav">
            <span className="tp-nav-ico" />
            {id === "fluent" && <span className="tp-nav-label is-short" />}
          </span>
          <span className="tp-nav">
            <span className="tp-nav-ico" />
            {id === "fluent" && <span className="tp-nav-label" />}
          </span>
          <span className="tp-nav tp-nav-bottom">
            <span className="tp-nav-ico" />
            {id === "fluent" && <span className="tp-nav-label is-short" />}
          </span>
        </span>
        <span className="tp-main">
          <span className="tp-hero">
            <span className="tp-hero-lines">
              <span className="tp-line is-title" />
              <span className="tp-line is-sub" />
            </span>
            <span className="tp-cta" />
          </span>
          <span className="tp-cards">
            <span className="tp-card">
              <span className="tp-line is-short" />
              <span className="tp-line is-sub" />
            </span>
            <span className="tp-card">
              <span className="tp-line is-short" />
              <span className="tp-line is-sub" />
            </span>
          </span>
        </span>
      </span>
    </span>
  </span>
);

/** Theme selector with crisp live-CSS miniature previews. */
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
    {THEME_REGISTRY.map((theme) => {
      const selected = value === theme.id;
      return (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={selected}
          className={`theme-option${selected ? " selected" : ""}`}
          onClick={() => onChange(theme.id as ThemeId)}
        >
          <ThemeMiniPreview id={theme.id as ThemeId} />
          <span className="theme-option-footer">
            <span className="theme-option-copy">
              <strong>{theme.name}</strong>
              <span className="theme-option-swatches" aria-hidden="true">
                <span style={{ background: theme.variables.bg }} />
                <span style={{ background: theme.variables.bg1 }} />
                <span style={{ background: theme.variables.primary }} />
              </span>
            </span>
            <span className="theme-option-check" aria-hidden={!selected}>
              <Icon name="i-tick" />
            </span>
          </span>
        </button>
      );
    })}
  </div>
);
