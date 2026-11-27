<script lang="ts" module>
  // Stroke icons in the style of Lucide (ISC licensed shapes, redrawn).
  const P: Record<string, string> = {
    plus: "M12 5v14M5 12h14",
    search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4",
    folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "folder-open": "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21.8 12A1.5 1.5 0 0 0 20.4 10H8.1a2 2 0 0 0-1.9 1.4L3.5 19",
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
    settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
    cloud: "M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.25 18z",
    refresh: "M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5",
    trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
    external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    "arrow-up": "M12 19V5M5 12l7-7 7 7",
    stop: "M7 7h10v10H7z",
    "chevron-down": "M6 9l6 6 6-6",
    "chevron-right": "M9 6l6 6-6 6",
    x: "M18 6 6 18M6 6l12 12",
    check: "M20 6 9 17l-5-5",
    alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    sparkle: "M12 3c.6 4.6 2.8 6.8 7.4 7.4l1.6.2-1.6.2C14.8 11.4 12.6 13.6 12 18.2c-.6-4.6-2.8-6.8-7.4-7.4L3 10.6l1.6-.2C9.2 9.8 11.4 7.6 12 3z",
    download: "M12 3v12M7 10l5 5 5-5M5 21h14",
    library: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -4 15.5-3.9-1z",
    message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
    "eye-off": "M9.9 4.2A9.8 9.8 0 0 1 12 4c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1A3 3 0 0 1 9.9 9.9M2 2l20 20",
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    lens: "M10.5 3.5a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20.5 20.5l-5-5M10.5 7c.35 1.9 1.6 3.15 3.5 3.5-1.9.35-3.15 1.6-3.5 3.5-.35-1.9-1.6-3.15-3.5-3.5 1.9-.35 3.15-1.6 3.5-3.5z",
  };
  export type IconName = keyof typeof P;
</script>

<script lang="ts">
  let {
    name,
    size = 16,
    filled = false,
    stroke = 1.8,
    class: cls = "",
  }: { name: IconName | string; size?: number; filled?: boolean; stroke?: number; class?: string } = $props();
</script>

<svg
  class="icon {cls}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={P[name] ?? ""} />
</svg>
