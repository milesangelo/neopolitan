import type { ProviderFailureClass, ProviderId } from '@neopolitan-ai/core';

export type FallbackRung = 'profile' | 'tier' | 'wait' | 'notify';

export interface TierModelEntry {
  readonly providerId: ProviderId;
  readonly modelPattern: string;
}

export interface TierGroup {
  readonly id: string;
  readonly models: ReadonlyArray<TierModelEntry>;
}

export interface FallbackPolicy {
  readonly ladder: ReadonlyArray<FallbackRung>;
  readonly tierGroups: ReadonlyArray<TierGroup>;
  readonly reasonOverrides?: Partial<Record<ProviderFailureClass, ReadonlyArray<FallbackRung>>>;
  readonly maxWaitMs: number;
  readonly returnToPreferred: 'prompt' | 'auto' | 'stay';
}

export function modelMatchesPattern(model: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
  );
  return regex.test(model);
}

export type FallbackAction =
  | { readonly kind: 'switch_profile'; readonly profileId: string }
  | { readonly kind: 'switch_tier_model'; readonly providerId: ProviderId; readonly model: string }
  | { readonly kind: 'wait'; readonly waitMs: number }
  | { readonly kind: 'notify'; readonly reason: ProviderFailureClass };

/**
 * Evaluates Traycer-style fallback ladders (`profile -> tier -> wait -> notify`) with
 * failure-class overrides and equivalent cross-provider tier groups.
 */
export class FallbackPolicyEngine {
  constructor(private readonly policy: FallbackPolicy) {}

  decideNextAction(input: {
    readonly failureClass: ProviderFailureClass;
    readonly currentProviderId: ProviderId;
    readonly currentModel: string;
    readonly currentProfileId?: string;
    readonly alternateProfileIds?: ReadonlyArray<string>;
    readonly attemptedProfiles?: ReadonlySet<string>;
    readonly attemptedModels?: ReadonlySet<string>;
    readonly retryAfterMs?: number;
  }): FallbackAction {
    const ladder = this.policy.reasonOverrides?.[input.failureClass] ?? this.policy.ladder;

    for (const rung of ladder) {
      if (rung === 'profile' && input.alternateProfileIds) {
        const nextProfile = input.alternateProfileIds.find(
          (id) => id !== input.currentProfileId && !input.attemptedProfiles?.has(id),
        );
        if (nextProfile) {
          return { kind: 'switch_profile', profileId: nextProfile };
        }
      }

      if (rung === 'tier') {
        const group = this.policy.tierGroups.find((g) =>
          g.models.some(
            (m) =>
              m.providerId === input.currentProviderId &&
              modelMatchesPattern(input.currentModel, m.modelPattern),
          ),
        );
        if (group) {
          const next = group.models.find(
            (m) =>
              !(
                m.providerId === input.currentProviderId &&
                modelMatchesPattern(input.currentModel, m.modelPattern)
              ) && !input.attemptedModels?.has(`${m.providerId}:${m.modelPattern}`),
          );
          if (next) {
            return {
              kind: 'switch_tier_model',
              providerId: next.providerId,
              model: next.modelPattern.replace(/\*/g, ''),
            };
          }
        }
      }

      if (rung === 'wait') {
        const waitMs = Math.min(input.retryAfterMs ?? 5_000, this.policy.maxWaitMs);
        if (waitMs > 0 && waitMs <= this.policy.maxWaitMs) {
          return { kind: 'wait', waitMs };
        }
      }

      if (rung === 'notify') {
        return { kind: 'notify', reason: input.failureClass };
      }
    }

    return { kind: 'notify', reason: input.failureClass };
  }
}
