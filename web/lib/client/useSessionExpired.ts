// ログインが切れたかどうか（client/session の知らせを、部品が描ける値にする）。横断-01。
import { useEffect, useState } from "react";
import { onSessionExpired } from "./session";

export const useSessionExpired = (): boolean => {
  const [expired, setExpired] = useState(false);
  useEffect(() => onSessionExpired(() => setExpired(true)), []);
  return expired;
};
