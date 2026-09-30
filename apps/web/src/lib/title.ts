import { useEffect } from "react";

export const APP_NAME = "Eone";

/** Sets the document title for the current view; restores the app name on unmount. */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
