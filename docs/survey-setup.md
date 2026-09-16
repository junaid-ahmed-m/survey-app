# Survey providers: Contentful &amp; third-party

Every batch carries its own survey configuration, so different QR runs can use different
providers at the same time. The choice is made in **Admin → Batches &amp; QR → New batch**
via the *Survey source* selector, which maps to `surveyType` on the batch:

| `surveyType` | Where the questions come from | Required field |
| ------------ | ----------------------------- | -------------- |
| `NATIVE` | Surveys built in **Admin → Surveys** | `surveyId` (a native survey id) |
| `CONTENTFUL` | Fetched live from Contentful | `surveyId` (a Contentful entry id) |
| `THIRD_PARTY` | An external survey tool (Typeform, SurveyMonkey, Qualtrics…) | `surveyUrl` (absolute URL) |

Regardless of the provider, the coupon is **reserved before the survey is shown**, so a
user is never sent into a survey the platform cannot reward.

---

## 1. Contentful

### 1.1 Configure the space

Add the credentials to `apps/api/.env` and restart the API:

```env
CONTENTFUL_SPACE_ID=your_space_id
CONTENTFUL_ENVIRONMENT=master
CONTENTFUL_ACCESS_TOKEN=your_content_delivery_api_token
```

Use a **Content Delivery API** token (read-only, `cdn.contentful.com`). Never use a
Content Management token here. If these are empty, a Contentful batch fails with
`CONTENTFUL_NOT_CONFIGURED` and the consumer sees a "try again later" message — the code
stays unused.

### 1.2 Content model

Create two content types. Field ids are matched leniently, so several common namings work.

**`survey`**

| Field id | Type | Notes |
| -------- | ---- | ----- |
| `title` (or `name`) | Short text | Shown as the survey heading |
| `description` | Short/long text | Optional sub-heading |
| `questions` (or `items`) | References, many | Links to `surveyQuestion` entries, in order |

**`surveyQuestion`**

| Field id | Type | Notes |
| -------- | ---- | ----- |
| `label` (or `question` / `title`) | Short text | Required — entries without it are skipped |
| `type` (or `questionType`) | Short text | See the table below |
| `required` | Boolean | Defaults to **true**; set to false to make it optional |
| `helpText` (or `description`) | Short text | Optional hint under the question |
| `options` (or `choices`) | Short text, list | Choice values; objects with `value`/`label` also work |
| `min`, `max` | Number | Bounds for `rating` |

**Question types** (`type` is lower-cased and `-`/spaces become `_`):

| Value | Renders as | Aliases accepted |
| ----- | ---------- | ---------------- |
| `single_choice` | One-of buttons | `radio`, `select`, `choice` |
| `multi_choice` | Multi-select buttons | `checkbox`, `multiselect`, `multiple` |
| `rating` | Star rating | `star`, `stars`, `score` |
| `nps` | 0–10 scale | — |
| `text` | Single-line input | — |
| `textarea` | Multi-line input | `long_text`, `paragraph` |

If `type` is missing, the question becomes `single_choice` when it has options, otherwise
`text`. Question ids come from the entry's `sys.id`, so **keep entries stable** — answers
are stored against those ids.

### 1.3 Create the batch

1. Publish the `survey` entry **and every linked question entry** (the Delivery API only
   returns published content).
2. Copy the survey entry id from the Contentful URL:
   `https://app.contentful.com/spaces/<space>/entries/**<entryId>**`
3. In the admin portal: **New batch → Survey source: Contentful → Contentful entry id**,
   pick the coupon type, set the prefix/length/quantity and create.

The entry id is stored on the batch, so editing copy in Contentful takes effect without
touching the platform.

### 1.4 Behaviour and limits

* Entries are fetched with `include=3` and cached in memory for **60 seconds** — content
  edits appear within a minute.
* Requests time out after 8 seconds; a failure returns `SURVEY_UNAVAILABLE`, the reserved
  coupon is released and the code stays `UNUSED`, so the consumer can rescan.
* Answers are stored by question id in `SurveyResponse.answers` exactly like native
  surveys, so **Admin → Responses** works the same way.
* Contentful answers are not re-validated against `required` on submit (native surveys
  are); the front end enforces required questions.

### 1.5 Quick check

```bash
curl -H "Authorization: Bearer $CONTENTFUL_ACCESS_TOKEN" \
  "https://cdn.contentful.com/spaces/$CONTENTFUL_SPACE_ID/environments/master/entries?sys.id=<entryId>&include=3"
```

If that returns your entry plus the linked questions under `includes.Entry`, the platform
will render it.

---

## 2. Third-party survey URL

Use this when the questionnaire lives in an external tool. The platform still owns code
validation and coupon issuing; the external tool only collects answers.

### 2.1 Create the batch

**New batch → Survey source: Third party → Survey URL**, e.g.
`https://forms.example.com/s/product-feedback`. The URL must be absolute and include the
protocol.

### 2.2 What the consumer sees

1. `/read/:code` verifies the code and reserves a coupon.
2. A card appears with a **Start the survey** button pointing at your URL, plus an e-mail
   box for people who already finished it.
3. After the external survey, the provider sends the user back to the platform, which
   asks for an e-mail and shows the coupon.

### 2.3 Parameters the platform appends

Two query parameters are added to your URL (existing query parameters are preserved):

| Parameter | Value | Purpose |
| --------- | ----- | ------- |
| `ref` | The session token | Correlate the external submission with the scan |
| `return_url` | `<PUBLIC_APP_URL>/survey/return?session=<sessionToken>` | Where to send the user afterwards |

Example:

```
https://forms.example.com/s/product-feedback
  ?ref=2f9c…&return_url=https%3A%2F%2Fapp.example.com%2Fsurvey%2Freturn%3Fsession%3D2f9c…
```

### 2.4 Configure the redirect in your survey tool

Point the survey's completion/redirect setting at the `return_url` value. Most tools can
use a piped variable, for example:

* **Typeform** – enable *Redirect on completion* and use `{{hidden:return_url}}` after
  adding `ref` and `return_url` as hidden fields.
* **SurveyMonkey** – *Survey completion → Redirect to URL*, using the custom variable.
* **Qualtrics** – *End of survey → Redirect to a URL*, with `${e://Field/return_url}`.

Store `ref` as a hidden field too — that is how you match a submission in the external
tool back to a scan.

If your tool cannot redirect, the flow still works: the consumer returns to the already
open tab and enters their e-mail there.

### 2.5 The return page

`/survey/return?session=<token>` rehydrates the session:

* Session still open → asks for an e-mail, then issues the coupon.
* Already completed → shows the coupon again (safe to reload or bookmark).
* Expired/unknown token → a friendly error; the reservation is released automatically.

Sessions live for `REDEEM_SESSION_TTL_MINUTES` (default 30). If the external survey takes
longer, raise that value — an expired session releases the coupon back to the pool and
the code returns to `UNUSED`.

### 2.6 What gets stored

The platform never receives the external answers. `SurveyResponse` records
`surveyType: 'THIRD_PARTY'`, `surveyRef` = the survey URL, and
`answers: { "source": "third_party" }`, together with the e-mail, code and batch. Export
the real answers from your survey tool and join on `ref`.

### 2.7 Security notes

* `PUBLIC_APP_URL` must be the real public origin — it is what `return_url` is built from.
* The session token is the credential for claiming the coupon; only pass it over HTTPS
  and do not expose it in publicly shared reports.
* The outbound link uses `rel="noopener noreferrer nofollow"`.
* The coupon is issued only after `POST /api/public/redeem/complete` succeeds for that
  session, and each code can be completed exactly once.

---

## 3. Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `CONTENTFUL_NOT_CONFIGURED` | Space id/token missing | Fill `CONTENTFUL_*` in `apps/api/.env` and restart the API |
| `SURVEY_UNAVAILABLE` on a Contentful batch | Entry unpublished, wrong id/environment, or Contentful unreachable | Verify with the curl call in 1.5 |
| Contentful survey renders with no questions | `questions` links unpublished, or entries missing `label` | Publish the question entries and add a label |
| A question renders as a text box | `type` unrecognised and no options | Use one of the values in 1.2 |
| Third-party batch rejected at creation | `surveyUrl` missing or not absolute | Include `https://` |
| User never returns from the external survey | Redirect not configured | Set the completion redirect to `return_url`, or let them use the e-mail box on the original tab |
| `SESSION_EXPIRED` on the return page | Survey took longer than the TTL | Increase `REDEEM_SESSION_TTL_MINUTES` |
| Content edits not visible | 60-second cache | Wait a minute or restart the API |
