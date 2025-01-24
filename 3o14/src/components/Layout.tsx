import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC = (props: PropsWithChildren) => (
  <html lang="en" >
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>3o14 </title>
      < link
        rel="stylesheet"
        href="/static/out.css"
      />
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    </head>
    < body >
      <main class="container" > {props.children} </main>
    </body>
  </html>
);
