import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

interface UpdateNotesProps {
  children: string;
  onOpenLink: (url: string) => void;
}

// Release notes are remote content: never send arbitrary URI schemes to the OS.
export function updateNotesUrl(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

export function UpdateNotes({ children, onOpenLink }: UpdateNotesProps) {
  return (
    <div className="update-notes">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={updateNotesUrl}
        components={{
          a: ({ href, children, title }) =>
            href ? (
              <a
                href={href}
                title={title}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLink(href);
                }}
                onAuxClick={(event) => {
                  event.preventDefault();
                  if (event.button === 1) onOpenLink(href);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt, title }) =>
            src ? (
              <img src={src} alt={alt} title={title} loading="lazy" />
            ) : (
              <span>{alt}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
