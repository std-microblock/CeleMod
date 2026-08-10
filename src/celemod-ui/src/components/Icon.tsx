import type { ComponentType, SVGProps } from "react";
import type { IconType } from "react-icons";
import {
  FaArrowUpRightFromSquare,
  FaCalendar,
  FaChartArea,
  FaCheck,
  FaCircleExclamation,
  FaChevronDown,
  FaChevronRight,
  FaClock,
  FaDownload,
  FaEllipsis,
  FaFileLines,
  FaFilter,
  FaFlag,
  FaFloppyDisk,
  FaGlobe,
  FaGamepad,
  FaHardDrive,
  FaHouse,
  FaHeart,
  FaImage,
  FaKeyboard,
  FaListUl,
  FaMagnifyingGlass,
  FaGear,
  FaPen,
  FaRotateRight,
  FaTableCellsLarge,
  FaTrash,
  FaStar,
  FaTriangleExclamation,
  FaEye,
  FaXmark,
} from "react-icons/fa6";
import { FaAsterisk } from "react-icons/fa";

const icons: Record<string, IconType> = {
  home: FaHouse,
  "chart-area": FaChartArea,
  search: FaMagnifyingGlass,
  drive: FaHardDrive,
  web: FaGlobe,
  flag: FaFlag,
  image: FaImage,
  download: FaDownload,
  heart: FaHeart,
  eye: FaEye,
  clock: FaClock,
  calendar: FaCalendar,
  grid: FaTableCellsLarge,
  list: FaListUl,
  file: FaFileLines,
  filter: FaFilter,
  edit: FaPen,
  save: FaFloppyDisk,
  delete: FaTrash,
  star: FaStar,
  warn: FaTriangleExclamation,
  external: FaArrowUpRightFromSquare,
  "opts-h": FaEllipsis,
  "i-down": FaChevronDown,
  "i-right": FaChevronRight,
  "i-asterisk": FaAsterisk,
  "i-cross": FaXmark,
  "i-tick": FaCheck,
  fail: FaCircleExclamation,
  replay: FaRotateRight,
  settings: FaGear,
  keyboard: FaKeyboard,
  gamepad: FaGamepad,
};

export const Icon = ({ name }: { name: string }) => {
  const Glyph = (icons[name] ??
    FaCircleExclamation) as unknown as ComponentType<SVGProps<SVGSVGElement>>;
  return (
    <Glyph
      className={`icon icon-${name}`}
      aria-hidden="true"
      focusable="false"
    />
  );
};
