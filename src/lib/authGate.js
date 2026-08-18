function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function getAuthAccessFingerprint(user) {
  if (!user?.id) return '';

  return stableSerialize({
    id: user.id,
    app_metadata: user.app_metadata || {},
  });
}

export function reconcileAuthUser(currentUser, nextUser, event) {
  if (
    event === 'TOKEN_REFRESHED' &&
    currentUser?.id &&
    nextUser?.id === currentUser.id &&
    getAuthAccessFingerprint(currentUser) === getAuthAccessFingerprint(nextUser)
  ) {
    return currentUser;
  }

  return nextUser || null;
}

export function getProtectedRouteDecision({
  authLoading,
  userId,
  mustChangePassword,
  resolvedUserId,
  onboardingStatus,
}) {
  if (authLoading) return 'cold-loading';
  if (!userId) return 'login';

  if (
    mustChangePassword ||
    onboardingStatus?.must_change_password === true ||
    onboardingStatus?.membership_status === 'pending'
  ) {
    return 'change-password';
  }

  if (resolvedUserId !== userId || !onboardingStatus) return 'cold-loading';
  if (onboardingStatus.membership_status === 'active') return 'allow';
  if (onboardingStatus.membership_status === 'verification_error') return 'verification-error';
  return 'access-denied';
}
