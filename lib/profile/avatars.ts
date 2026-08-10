export const AVATAR_COUNT = 14;

export function safeAvatarNumber(value: unknown) {
  const avatar = Math.round(Number(value || 1));
  return Number.isFinite(avatar) && avatar >= 1 && avatar <= AVATAR_COUNT
    ? avatar
    : 1;
}

export function avatarAssetUrl(value: unknown) {
  return `/app-assets/avatars/Avater${safeAvatarNumber(value)}.png`;
}
