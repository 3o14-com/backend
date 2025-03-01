import type { PropsWithChildren } from "hono/jsx";

export interface LayoutProps {
  title: string;
  shortTitle?: string | null;
  url?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  links?: { href: string | URL; rel: string; type?: string }[];
}

export function Layout(props: PropsWithChildren<LayoutProps>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta property="og:title" content={props.shortTitle ?? props.title} />
        {props.description && (
          <>
            <meta name="description" content={props.description} />
            <meta property="og:description" content={props.description} />
          </>
        )}
        {props.url && (
          <>
            <link rel="canonical" href={props.url} />
            <meta property="og:url" content={props.url} />
          </>
        )}
        {props.imageUrl && (
          <meta property="og:image" content={props.imageUrl} />
        )}
        {props.links?.map((link) => (
          <link
            rel={link.rel}
            href={link.href instanceof URL ? link.href.href : link.href}
            type={link.type}
          />
        ))}
        <link rel="stylesheet" href="/public/styles.css" />
        <link
          rel="icon"
          type="image/png"
          sizes="500x500"
          href="/public/favicon.png"
          media="(prefers-color-scheme: light)"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="500x500"
          href="/public/favicon-white.png"
          media="(prefers-color-scheme: dark)"
        />
        <script type="text/javascript" id="MathJax-script" async
          src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-mml-chtml.js">
        </script>
        <script type="text/javascript">
          {`
                    window.MathJax = {
                      tex: {
                        inlineMath: [["\\(", "\\)"]],
                        displayMath: [["\\[", "\\]"]],
                        processEscapes: false,
                      },
                      options: {
                        ignoreHtmlClass: 'no-mathjax',
                      }
                    };
                  `}
        </script>
      </head>
      <body>
        <main className="container">{props.children}</main>
      </body>
      <script src="/public/script.js"></script>
    </html>
  );
}
