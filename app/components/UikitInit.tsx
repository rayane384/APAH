"use client";
import { useEffect } from "react";
import UIkit from "uikit";
import Icons from "uikit/dist/js/uikit-icons";

export default function UikitInit() {
  useEffect(() => {
    // register icons
    if (UIkit && UIkit.use) {
      UIkit.use(Icons);
    }
  }, []);

  return null;
}
