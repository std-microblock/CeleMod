import type { ComponentType, SVGProps } from 'react';
import type { IconType } from 'react-icons';
import {
  FaArrowUpRightFromSquare,
  FaChartArea,
  FaCheck,
  FaCircleExclamation,
  FaChevronDown,
  FaChevronRight,
  FaClock,
  FaDownload,
  FaEllipsis,
  FaFileLines,
  FaFlag,
  FaFloppyDisk,
  FaGlobe,
  FaHardDrive,
  FaHouse,
  FaImage,
  FaMagnifyingGlass,
  FaPen,
  FaRotateRight,
  FaTableCellsLarge,
  FaTrash,
  FaTriangleExclamation,
  FaXmark,
} from 'react-icons/fa6';
import { FaAsterisk } from 'react-icons/fa';

const icons: Record<string, IconType> = {
  home: FaHouse,
  'chart-area': FaChartArea,
  search: FaMagnifyingGlass,
  drive: FaHardDrive,
  web: FaGlobe,
  flag: FaFlag,
  image: FaImage,
  download: FaDownload,
  clock: FaClock,
  grid: FaTableCellsLarge,
  file: FaFileLines,
  edit: FaPen,
  save: FaFloppyDisk,
  delete: FaTrash,
  warn: FaTriangleExclamation,
  external: FaArrowUpRightFromSquare,
  'opts-h': FaEllipsis,
  'i-down': FaChevronDown,
  'i-right': FaChevronRight,
  'i-asterisk': FaAsterisk,
  'i-cross': FaXmark,
  'i-tick': FaCheck,
  fail: FaCircleExclamation,
  replay: FaRotateRight,
};

export const Icon = ({ name }: { name: string }) => {
  const Glyph = (icons[name] ?? FaCircleExclamation) as unknown as ComponentType<SVGProps<SVGSVGElement>>;
  return <Glyph className={`icon icon-${name}`} aria-hidden="true" focusable="false" />;
};
