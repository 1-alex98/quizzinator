import Icon, { type IconProps } from "@mui/material/Icon";

// Material Symbols Rounded (loaded as a font in index.html) rendered through
// MUI's Icon so it picks up theme colour/size props. Kept as a font rather
// than pulling in @mui/icons-material: the icon set is already loaded, and
// the SVG package is a large dependency for a handful of glyphs.
export function AppIcon({ name, ...props }: { name: string } & Omit<IconProps, "children">) {
  return (
    <Icon baseClassName="material-symbols-rounded" {...props}>
      {name}
    </Icon>
  );
}
