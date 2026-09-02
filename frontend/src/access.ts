export default function access(initialState: { currentUser?: API.CurrentUser } | undefined) {
  const { currentUser } = initialState ?? {};
  return { isAdmin: currentUser?.role === 'admin' };
}
