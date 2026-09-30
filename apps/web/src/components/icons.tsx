import type { FindingStatusDto, VerdictDto } from "@app/contracts";
import type { ReactNode, SVGProps } from "react";

/** Monochrome line icons in the text colour, sized to sit inside badges and links. */
function Icon({ children, size = 12, ...props }: { children: ReactNode; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = { size?: number };
export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Icon>
);
export const CrossIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 2.5l6 11H2z" />
    <path d="M8 7v2.5M8 11.6v.1" />
  </Icon>
);
export const QuestionIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.3a1.8 1.8 0 113 1.4c-.7.4-1.3.8-1.3 1.6M8 11.5v.1" />
  </Icon>
);
export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 8h8" />
  </Icon>
);
export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 1.8l5 2v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z" />
    <path d="M5.8 8l1.6 1.5 2.8-3" />
  </Icon>
);
export const GlobeIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14c-1.8-1.7-2.6-3.7-2.6-6S6.2 3.7 8 2z" />
  </Icon>
);
export const EyeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);
export const DownloadIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
  </Icon>
);
export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </Icon>
);

export const FileIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9.5 1.8H4.2v12.4h7.6V4.1z" />
    <path d="M9.5 1.8v2.3h2.3M6 7.5h4M6 10h4" />
  </Icon>
);
export const RulesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 4l1 1 1.8-2M2.5 8.5l1 1 1.8-2M2.5 13l1 1 1.8-2M8 4.5h5.5M8 9h5.5M8 13.5h5.5" />
  </Icon>
);

export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Icon>
);

export const FilterIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2 3.5h12l-4.5 5.2v4.3l-3 1.5V8.7z" />
  </Icon>
);

export const verdictIcon: Record<VerdictDto, ReactNode> = { pass: <CheckIcon />, warn: <AlertIcon />, fail: <CrossIcon /> };
export const findingIcon: Record<FindingStatusDto, ReactNode> = {
  pass: <CheckIcon />,
  fail: <CrossIcon />,
  partial: <AlertIcon />,
  unclear: <QuestionIcon />,
  not_applicable: <MinusIcon />,
};
