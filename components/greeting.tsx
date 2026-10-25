"use client";

import { useEffect, useState } from "react";

export function Greeting({ name }: { name: string }) {
  const [label, setLabel] = useState("Good morning");
  useEffect(() => {
    const h = new Date().getHours();
    setLabel(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return (
    <span>
      {label}
      {name ? `, ${name}` : ""}
    </span>
  );
}
