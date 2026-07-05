export interface FeatureFlagSource {
  isEnabled(key: string): boolean;
}

// Env-backed for now (FEATURE_<KEY>=true). Swap this instance for a
// DB-backed FeatureFlagSource once flags need to change without a redeploy -
// callers only ever see isEnabled()/isThemeAllowed(), not the source.
class EnvFeatureFlagSource implements FeatureFlagSource {
  isEnabled(key: string): boolean {
    return process.env[`FEATURE_${key.toUpperCase()}`] === "true";
  }
}

const source: FeatureFlagSource = new EnvFeatureFlagSource();

export function isEnabled(key: string): boolean {
  return source.isEnabled(key);
}

export function isThemeAllowed(theme: string): boolean {
  return theme === "standard" || isEnabled("themes");
}
