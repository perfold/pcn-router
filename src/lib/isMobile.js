import { useState, useEffect } from "react";

// check if device is a mobile phone
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 600); // if viewport width < 600, probably phone (my galaxy a55 is 384px)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}
