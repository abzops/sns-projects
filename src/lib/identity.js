/**
 * Central safe member identity resolver.
 * Handles null/empty full_name, pending invited emails, and current user fallback.
 */
export function getMemberDisplayName(member, currentUser = null) {
  if (!member) return 'Member';

  const profile = member.profile || member.profiles;
  const fullName = profile?.full_name?.trim();
  if (fullName) {
    return fullName;
  }

  if (member.invited_email && member.invited_email.trim()) {
    return member.invited_email.trim();
  }

  if (currentUser && member.user_id === currentUser.id && currentUser.email) {
    return currentUser.email.trim();
  }

  return 'Member';
}

export function getMemberEmail(member, currentUser = null) {
  if (!member) return null;

  if (member.invited_email && member.invited_email.trim()) {
    return member.invited_email.trim();
  }

  if (currentUser && member.user_id === currentUser.id && currentUser.email) {
    return currentUser.email.trim();
  }

  const profile = member.profile || member.profiles;
  return profile?.email || null;
}
