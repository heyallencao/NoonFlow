"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { useFontSize } from "@/components/layout/FontSizeProvider";
import { SUPPORTED_LOCALES, type Locale } from "@/i18n";

export function AppearanceSection() {
  const { t, locale, setLocale } = useTranslation();
  const {
    fontScale,
    fontScalePercent,
    defaultFontScale,
    minFontScale,
    maxFontScale,
    setFontScale,
    increaseFontScale,
    decreaseFontScale,
    resetFontScale,
  } = useFontSize();
  
  const fontScalePresets = Array.from(
    new Set([0.95, 1, defaultFontScale, 1.1, 1.15].map((scale) => Number(scale.toFixed(4))))
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[15px] font-semibold mb-1.5">{t('settings.appearance')}</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Customize the look and feel of the application. Changes are applied immediately across the entire workspace.
        </p>
      </div>

      <div className="space-y-6">
        {/* Typography */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Typography</h3>

          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <label className="text-base font-semibold leading-none">
                {t('settings.fontSizeTitle')}
              </label>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('settings.fontSizeDesc')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={decreaseFontScale}
                  disabled={fontScale <= minFontScale}
                  className="hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                >
                  {t('settings.fontSizeSmaller')}
                </Button>
                <div className="flex items-center justify-center px-3 h-9 font-mono text-sm font-medium text-primary">
                  {t('settings.fontSizeCurrent', { percent: fontScalePercent })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={increaseFontScale}
                  disabled={fontScale >= maxFontScale}
                  className="hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                >
                  {t('settings.fontSizeLarger')}
                </Button>
                <Button variant="ghost" size="sm" onClick={resetFontScale} className="hover:bg-primary/10 hover:text-primary">
                  {t('settings.fontSizeReset')}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {fontScalePresets.map((scale) => {
                  const scalePercent = Math.round(scale * 100);
                  const isActive = Math.abs(fontScale - scale) < 0.001;
                  return (
                    <button
                      key={scale}
                      className={`h-8 px-3 text-sm font-medium transition-all rounded-md ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-primary/30 shadow-md'
                          : 'hover:bg-primary/10 text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/50'
                      }`}
                      onClick={() => setFontScale(scale)}
                    >
                      {scalePercent}%
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                {t('settings.fontSizeShortcut')}
              </p>
            </div>
          </div>
        </section>

        {/* Localization */}
        <section className="space-y-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary/80">Localization</h3>

          <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <label className="text-base font-semibold leading-none">
                {t('settings.language')}
              </label>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('settings.languageDesc')}
              </p>
            </div>

            <div>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger className="w-full sm:max-w-xs h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LOCALES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
