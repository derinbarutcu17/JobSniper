import { onboardProfile } from "../../normalization/profile.js";
import type { OnboardRequest, ProfileSummary } from "../../types.js";

export interface ProfileService {
  onboard(request: OnboardRequest): Promise<{ profile: ProfileSummary }>;
}

export function createProfileService(baseDir: string): ProfileService {
  return {
    async onboard(request) {
      const result = await onboardProfile(baseDir, request.input);
      return { profile: result.profile };
    },
  };
}
