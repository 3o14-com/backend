import type { Variables } from "../../middlewares/oauth";
import apps from "./apps";
import accounts from "./accounts";
import featured_tags from "./featured_tags";
import follow_requests from "./follow_request";
import instance from "./instance";
import lists from "./list";
import markers from "./marker";
import media from "./media";
import notifications from "./notification";
import polls from "./polls";
// TODO reports
// import reports from "./reports";
import statuses from "./status";
// TODO tags
// import tags from "./tags";
import timelines from "./timelines";


import { Hono } from "hono";

const app = new Hono<{ Variables: Variables }>();


app.route("/apps", apps);
app.route("/accounts", accounts)
app.route("/featured_tags", featured_tags);
app.route("/follow_requests", follow_requests);
app.route("/instance", instance);
app.route("/lists", lists);
app.route("/markers", markers);
app.route("/media", media);
app.route("/notifications", notifications);
app.route("/polls", polls);
app.route("/statuses", statuses);
// app.route("/tags", tags);
app.route("/timelines", timelines);
// app.route("/reports", reports);

export default app;
