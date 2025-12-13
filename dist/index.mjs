import { Readable } from 'node:stream';
import * as _ from 'marko/html';
import PocketBase from 'pocketbase';
import 'prismjs';
import compression from 'compression';
import { createServer } from 'http';
import { dirname } from 'path';
import createStaticServe from 'serve-static';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

function getForwardedHeader(req, name) {
  const value = req.headers["x-forwarded-" + name];
  if (value) {
    if (typeof value === "string") {
      const index = value.indexOf(",");
      return index < 0 ? value : value.slice(0, index);
    }
    return value[0];
  }
}
function getOrigin(req, trustProxy) {
  const protocol = trustProxy && getForwardedHeader(req, "proto") || req.socket.encrypted && "https" || req.protocol || "http";
  let host = trustProxy && getForwardedHeader(req, "host") || req.headers.host;
  if (!host) {
    {
      throw new Error(
        `Could not automatically determine the origin host. Use the 'origin' option or the 'ORIGIN' environment variable to set the origin explicitly.`
      );
    }
  }
  return `${protocol}://${host}`;
}
function copyResponseHeaders(response, headers) {
  for (const [key, value] of headers) {
    if (key !== "set-cookie") {
      response.setHeader(key, value);
    }
  }
  const setCookies = headers.getSetCookie();
  if (setCookies == null ? void 0 : setCookies.length) {
    response.appendHeader("set-cookie", setCookies);
  }
}
function createMiddleware(fetch, options) {
  const {
    origin = process.env.ORIGIN,
    trustProxy = process.env.TRUST_PROXY === "1",
    createPlatform = (platform) => platform
  } = options ?? (options = {});
  return async (req, res, next) => {
    var _b, _c;
    try {
      var devWebSocket; if (false) ;
      let body;
      switch (req.method) {
        case "POST":
        case "PUT":
        case "PATCH":
          if (Readable.isDisturbed(req)) {
            body = bodyConsumedErrorStream;
          } else {
            body = req;
          }
          break;
      }
      const url = new URL(req.url, origin || getOrigin(req, trustProxy));
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body,
        // @ts-expect-error: Node requires this for streams
        duplex: "half"
      });
      const platform = createPlatform({
        request: req,
        response: res
      });
      const response = await fetch(request, platform);
      if (res.destroyed || res.headersSent) {
        return;
      }
      if (response) {
        res.statusCode = response.status;
        copyResponseHeaders(res, response.headers);
        if (response.body) {
          for await (const chunk of response.body) {
            if (res.destroyed) return;
            res.write(chunk);
            (_b = res.flush) == null ? void 0 : _b.call(res);
          }
        } else if (!response.headers.has("content-length")) {
          res.setHeader("content-length", "0");
        }
        res.end();
      } else if (next) {
        next();
      }
    } catch (err) {
      const error = err;
      if (next) {
        next(error);
      } else {
        (_c = res.socket) == null ? void 0 : _c.destroySoon();
        console.error(error);
      }
    }
  };
}
var bodyConsumedErrorStream = new ReadableStream({
  pull(controller) {
    controller.error(
      new Error(
        "The request body stream has been destroyed or consumed by something before Marko Run."
      )
    );
  }
});

var NotHandled = Symbol(
  "marko-run not handled"
);
var NotMatched = Symbol(
  "marko-run not matched"
);
var parentContextLookup = /* @__PURE__ */ new WeakMap();
var serializedGlobals = { params: true, url: true };
var pageResponseInit = {
  status: 200,
  headers: { "content-type": "text/html;charset=UTF-8" }
};
globalThis.MarkoRun ?? (globalThis.MarkoRun = {
  NotHandled,
  NotMatched,
  route(handler) {
    return handler;
  }
});
var toReadable = (rendered) => {
  toReadable = rendered.toReadable ? (rendered2) => rendered2.toReadable() : (rendered2) => {
    let cancelled = false;
    return new ReadableStream({
      async start(ctrl) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of rendered2) {
            if (cancelled) {
              return;
            }
            ctrl.enqueue(encoder.encode(chunk));
          }
          ctrl.close();
        } catch (err) {
          if (!cancelled) {
            ctrl.error(err);
          }
        }
      },
      cancel() {
        cancelled = true;
      }
    });
  };
  return toReadable(rendered);
};
function createContext(route, request, platform, url = new URL(request.url)) {
  let meta;
  let params;
  let path;
  if (route) {
    meta = route.meta;
    params = route.params;
    path = route.path;
  } else {
    meta = {};
    params = {};
    path = "";
  }
  return {
    request,
    url,
    platform,
    meta,
    params,
    route: path,
    serializedGlobals,
    parent: parentContextLookup.get(request),
    async fetch(resource, init) {
      let request2;
      let url2;
      if (resource instanceof Request) {
        request2 = new Request(resource, init);
        url2 = new URL(request2.url);
      } else {
        url2 = typeof resource === "string" ? new URL(resource, this.url) : resource;
        request2 = new Request(url2, init);
      }
      parentContextLookup.set(request2, this);
      return await globalThis.__marko_run__.fetch(request2, this.platform) || new Response(null, { status: 404 });
    },
    render(template, input, init = pageResponseInit) {
      return new Response(
        toReadable(
          template.render({
            ...input,
            $global: this
          })
        ),
        init
      );
    },
    redirect(to, status = 302) {
      if (typeof status !== "number") {
        throw new RangeError("Invalid status code 0");
      } else if (status < 301 || status > 308 || status > 303 && status < 307) {
        throw new RangeError(`Invalid status code ${status}`);
      }
      return new Response(null, {
        status,
        headers: {
          location: (typeof to === "string" ? new URL(to, this.url) : to).href
        }
      });
    },
    back(fallback = "/", status) {
      return this.redirect(
        this.request.headers.get("referer") || fallback,
        status
      );
    }
  };
}
function stripResponseBodySync(response) {
  return response.body ? new Response(null, response) : response;
}
function stripResponseBody(response) {
  return "then" in response ? response.then(stripResponseBodySync) : stripResponseBodySync(response);
}

const _faviconPng = "data:image/png;base64,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";

const _search = _._template("g", input => {
  _._scope_id();
  _._html("<form action=/search method=get><input type=search name=q placeholder=\"Search posts by title...\"></form>");
});

const Layout1 = _._template("b", input => {
  const $scope0_reason = _._scope_reason();
  const $scope0_id = _._scope_id();
  _._html(`<!doctype html><html lang=en><head>${_._unescaped(_.$global().___viteRenderAssets?.("head-prepend"))}<meta charset=UTF-8><link rel=icon type=image/png sizes=32x32${_._attr("href", _faviconPng)}><meta name=viewport content="width=device-width, initial-scale=1.0"><meta name=description content="A basic Marko app."><title>${_._escape(_.$global().meta.pageTitle || "Arnold Gunter Blog")}</title>${_._unescaped(_.$global().___viteRenderAssets?.("head"))}</head><body>${_._unescaped(_.$global().___viteRenderAssets?.("body-prepend"))}`);
  if (_.$global().url.pathname !== "/") {
    _._scope_id();
    _._html("<header class=global-header><a href=\"/\" class=global-header__title><img src=/avatar.avif alt=\"Arnold Gunter Logo\" class=global-header__logo> Arnold Gunter</a>");
    _search({});
    _._html("</header>");
  }
  _._dynamic_tag($scope0_id, "g", input.content, {}, 0, 0, _._serialize_guard($scope0_reason, /* input.content */0));
  _._html(`<footer><p>© ${_._escape(new Date().getFullYear())} Arnold Gunter • All rights reserved. • <a href=/privacy>Privacy Policy</a></p></footer>${_._unescaped(_.$global().___viteRenderAssets?.("body"))}`), _._trailers("</body></html>");
  _._serialize_if($scope0_reason, /* input.content */0) && _._scope($scope0_id, {});
});

const _headerForm = _._template("e", input => {
  const $scope0_id = _._scope_id();
  _._if(() => {
    {
      const $scope1_id = _._scope_id();
      _._html(`<div class=ck-form-wrapper><button class=ck-close>✕</button>${_._el_resume($scope1_id, "a")}<form action=https://app.kit.com/forms/8825776/subscriptions method=post class=ck-form data-sv-form=8825776><div class="ck-alert ck-error" hidden>Please fill all required fields correctly!</div><div class="ck-alert ck-success" hidden>Thank you for subscribing! Check your inbox (or spam folder) to confirm your subscription.</div><div class="ck-alert ck-loading" hidden>Submitting...</div><div class=ck-fields><h2 class=ck-title>Get the weekly newsletter!</h2><input name=fields[first_name] type=text class=ck-input placeholder="Your first name" required><input name=email_address type=email class=ck-input placeholder="Your email address" required><button type=submit class=ck-submit>Sign up</button></div></form></div>`);
      _._script($scope1_id, "e0");
      _._scope($scope1_id, {
        _: _._scope_with_id($scope0_id)
      });
      return 0;
    }
  }, $scope0_id, "a", 1, /* showForm */1, /* showForm */1, 0, 1);
  _._script($scope0_id, "e1");
  _._scope($scope0_id, {});
  _._resume_branch($scope0_id);
});

// Wenn du lokal arbeitest:
const pb = new PocketBase("http://127.0.0.1:8090");

// Optional: Session persistieren, z. B. für Admin Login
// pb.authStore.loadFromCookie(document?.cookie || "");

const _topics = _._template("i", input => {
  const $scope0_id = _._scope_id();
  _._try($scope0_id, "a", _._content_resume("i2", () => {
    const $scope1_id = _._scope_id();
    _._await($scope1_id, "a", pb.collection("tags").getFullList(), data => {
      _._scope_id();
      _._html("<div class=marquee><ul class=marquee__inner>");
      _.forOf(data, tag => {
        _._scope_id();
        _._html(`<li class=tag-list><a${_._attr("href", `/tag/${tag.slug}`)} class=tag>${_._escape(tag.name)}</a></li>`);
      });
      _.forOf(data, tag => {
        _._scope_id();
        _._html(`<li class=tag-list><a${_._attr("href", `/tag/${tag.slug}`)} class=tag>${_._escape(tag.name)}</a></li>`);
      });
      _._html("</ul></div>");
    }, 0);
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("i1", err => {
        const $scope3_reason = _._scope_reason();
        const $scope3_id = _._scope_id();
        _._html(`<div class=error>Error fetching tags: ${_._sep(_._serialize_guard($scope3_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope3_id, "a", _._serialize_guard($scope3_reason, /* err.message */0))}</div>`);
        _._serialize_if($scope3_reason, /* err.message */0) && _._scope($scope3_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("i0", () => {
        _._scope_id();
        _._html("<div>Loading tags...</div>");
      }, $scope0_id)
    })
  });
});

const _startpagePosts = _._template("h", input => {
  const $scope0_id = _._scope_id();
  const $posts__closures = new Set();
  const $page__closures = new Set();
  const $isLoading__closures = new Set();
  const $hasMore__closures = new Set();
  let posts = [];
  let page = 1;
  let limit = 2;
  let isLoading = false;
  let hasMore = true;
  _._try($scope0_id, "a", _._content_resume("h4", () => {
    const $scope1_id = _._scope_id();
    _._await($scope1_id, "a", pb.collection("posts").getList(1, limit, {
      sort: "-created"
    }), data => {
      const $scope2_id = _._scope_id();
      _._html("<div class=posts>");
      _._for_of(posts.length ? posts : data.items, post => {
        const $scope6_id = _._scope_id();
        _._html(`<a${_._attr("href", `/post/${post.slug}`)} class=post><span class=post-content><small>${_._escape(new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        }).format(new Date(post.created)))}${_._el_resume($scope6_id, "b")}</small><h5>${_._escape(post.title)}${_._el_resume($scope6_id, "c")}</h5><p>${_._escape(post.subtitle)}${_._el_resume($scope6_id, "d")}</p></span><img${_._attr("src", `http://127.0.0.1:8090/api/files/${post.collectionId}/${post.id}/${post.cover}?thumb=300x150`)}${_._attr("alt", `${post.title}`)} class=post-image>${_._el_resume($scope6_id, "e")}</a>${_._el_resume($scope6_id, "a")}`);
        _._scope($scope6_id, {});
      }, 0, $scope2_id, "a", /* posts */1, /* posts */1, /* posts */1, 0, 1);
      _._if(() => {
        {
          const $scope3_id = _._scope_id();
          _._html(`<button class=load-more-btn${_._attr("disabled", isLoading)}>`);
          _._if(() => {
            {
              const $scope8_id = _._scope_id();
              _._html("Load more");
              _._scope($scope8_id, {});
              return 1;
            }
          }, $scope3_id, "a", 1, 1, /* isLoading */1, "</button>");
          _._script($scope3_id, "h0");
          _._subscribe($hasMore__closures, _._subscribe($isLoading__closures, _._subscribe($page__closures, _._subscribe($posts__closures, _._scope($scope3_id, {
            _: _._scope_with_id($scope2_id),
            Cb: 1,
            Cc: 0,
            Ce: 0,
            Cf: 1
          })))));
          return 0;
        }
      }, $scope2_id, "b", 1, /* hasMore */1, /* hasMore */1, 0, 1);
      _._html("</div>");
      _._script($scope2_id, "h1");
      _._subscribe($hasMore__closures, _._subscribe($posts__closures, _._scope($scope2_id, {
        e: data?.items,
        g: data?.page,
        h: data?.totalPages,
        _: _._scope_with_id($scope1_id),
        Cb: 0,
        Cf: 0
      })));
      _._resume_branch($scope2_id);
    });
    _._scope($scope1_id, {
      _: _._scope_with_id($scope0_id)
    });
    _._resume_branch($scope1_id);
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("h3", err => {
        const $scope5_reason = _._scope_reason();
        const $scope5_id = _._scope_id();
        _._html(`<div class=error>Error: ${_._sep(_._serialize_guard($scope5_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope5_id, "a", _._serialize_guard($scope5_reason, /* err.message */0))}</div>`);
        _._serialize_if($scope5_reason, /* err.message */0) && _._scope($scope5_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("h2", () => {
        _._scope_id();
        _._html("<div class=loading>Loading posts\u2026</div>");
      }, $scope0_id)
    })
  });
  _._scope($scope0_id, {
    b: posts,
    c: page,
    d: limit,
    e: isLoading,
    f: hasMore,
    Bb: $posts__closures,
    Bc: $page__closures,
    Be: $isLoading__closures,
    Bf: $hasMore__closures
  });
  _._resume_branch($scope0_id);
});

const Page$5 = _._template("c", input => {
  const $scope0_id = _._scope_id();
  _._html("<div class=container><header>");
  _headerForm({});
  _._html("<picture class=hero-image><source type=image/avif srcset=\"/hero_image_769.avif 769w, /hero_image_1200.avif 1200w, /hero_image.avif 2000w\" sizes=100vw loading=lazy><img src=/hero_image.png alt=\"Hero image\"></picture><div class=avatar-section><img src=/avatar.avif alt=\"Arnold Gunter Profile Picture\" class=profile-picture>");
  _search({});
  _._html("</div><div class=topics>");
  _topics({});
  _._html("</div></header><main><div class=\"about-me fade-in hidden\"><div class=about-me__content><h4>Hi! My name is Arnold Gunter,</h4><p>I'm a software developer who loves blogging as much as coding. I spend most of my time building projects for companies in React, React Native, Next.js, and Marko.js.</p><p>I can\u2019t stand TypeScript and TailwindCSS \uD83D\uDE05.</p><p>I\u2019m obsessed with cutting-edge tech and always chasing the next tool worth learning.</p></div><img src=/about_image.avif alt=\"A man sitting on a desk working on a computer\" class=about-me-picture fetchpriority=high></div><h3 class=\"latest-posts-title fade-in hidden\">Latest posts</h3><p class=\"fade-in hidden\">Click on a post and start enjoying my blog!</p>");
  _startpagePosts({});
  _._html("</main></div><script data-goatcounter=https://arnoldgunter.goatcounter.com/count async src=//gc.zgo.at/count.js></script>");
  _._script($scope0_id, "c0");
});

const Template$5 = _._template("esfPH6H", input => {
  _._scope_id();
  Layout1({
    content: _._content("NU9jT3X", () => {
      _._scope_id();
      Page$5({});
    })
  });
});

const base = "/";
function getPrepend(g) {
  return g.___viteRenderAssets("head-prepend") + g.___viteRenderAssets("head") + g.___viteRenderAssets("body-prepend");
}
function getAppend(g) {
  return g.___viteRenderAssets("body-prepend");
}
function addAssets(g, newEntries) {
  const entries = g.___viteEntries;
  if (entries) {
    g.___viteEntries = entries.concat(newEntries);
    return true;
  }
  g.___viteEntries = newEntries;
  g.___viteRenderAssets = renderAssets;
  g.___viteInjectAttrs = g.cspNonce ? ` nonce="${g.cspNonce.replace(/"/g, "&#39;")}"` : "";
  g.___viteSeenIds = /* @__PURE__ */ new Set();
}
function renderAssets(slot) {
  const entries = this.___viteEntries;
  let html = "";
  if (entries) {
    const seenIds = this.___viteSeenIds;
    const slotWrittenEntriesKey = `___viteWrittenEntries-${slot}`;
    const lastWrittenEntry = this[slotWrittenEntriesKey] || 0;
    const writtenEntries = this[slotWrittenEntriesKey] = entries.length;
    for (let i = lastWrittenEntry; i < writtenEntries; i++) {
      let entry = entries[i];
      if (typeof entry === "string") {
        entry = __MARKO_MANIFEST__[entry] || {};
      }
      const parts = entry[slot];
      if (parts) {
        for (let i2 = 0; i2 < parts.length; i2++) {
          const part = parts[i2];
          switch (part) {
            case 0:
              html += this.___viteInjectAttrs;
              break;
            case 1:
              html += base;
              break;
            case 2: {
              const id = parts[++i2];
              const skipParts = parts[++i2];
              if (seenIds.has(id)) {
                i2 += skipParts;
              } else {
                seenIds.add(id);
              }
              break;
            }
            default:
              html += part;
              break;
          }
        }
      }
    }
  }
  return html;
}

function flush$5($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush$5($global) {
  $global.__flush__ = flush$5;
}
const page$4 = _._template("yovW1RF", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), [".marko-run_1v7P"]) || setFlush$5(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template$5({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const pageTitle$4 = "Arnold Gunter | Web Development & Tech Blog";
const pageDescription$4 = "Stay ahead in web development and tech with Arnold Gunter. Explore tutorials, programming guides, insights on React, Next.js, Marko.js, TypeScript, TailwindCSS, and more.";
const pageKeywords$4 = "Arnold Gunter, Web Development, Programming, React, Next.js, Marko.js, TypeScript, TailwindCSS, Software Development, Coding Tutorials, Tech Blog, Developer Insights";
const meta2 = {
  pageTitle: pageTitle$4,
  pageDescription: pageDescription$4,
  pageKeywords: pageKeywords$4,
};

// virtual:marko-run__marko-run__index.js

function get2(context) {
	return context.render(page$4, {});
}

function head2(context) {
	return stripResponseBody(get2(context));
}

const fetchSidebarData = async () => {
  // Neueste Posts
  const postsRes = await pb.collection("posts").getList(1, 5, {
    sort: "-created",
    fields: "id,collectionId,collectionName,title,slug,created,cover"
  });

  // Tags mit Count
  const tags = await pb.collection("tags").getFullList({
    sort: "name"
  });
  return {
    latestPosts: postsRes.items,
    tags: tags
  };
};
const _aside = _._template("d", input => {
  const $scope0_id = _._scope_id();
  _._try($scope0_id, "a", _._content_resume("d2", () => {
    const $scope1_id = _._scope_id();
    _._await($scope1_id, "a", fetchSidebarData(), data => {
      _._scope_id();
      _._html("<div class=aside><h4>Latest Posts</h4><ul>");
      _.forOf(data.latestPosts, post => {
        _._scope_id();
        _._html(`<li><a${_._attr("href", `/post/${post.slug}`)} class=post-link><small>${_._escape(new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        }).format(new Date(post.created)))}</small>`);
        if (post.title.length > 50) {
          _._scope_id();
          _._html(`<h6>${_._escape(post.title.slice(0, 50))}...</h6>`);
        } else {
          _._scope_id();
          _._html(`<h6>${_._escape(post.title)}</h6>`);
        }
        _._html("</a></li>");
      });
      _._html("</ul><h5>Tags</h5><ul class=tag-list>");
      _.forOf(data.tags, tag => {
        _._scope_id();
        _._html(`<li><a${_._attr("href", `/tag/${tag.slug}`)} class=tag-link>${_._escape(tag.name)}</a></li>`);
      });
      _._html("</ul></div>");
    }, 0);
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("d1", err => {
        const $scope3_reason = _._scope_reason();
        const $scope3_id = _._scope_id();
        _._html(`<div>Fehler: ${_._sep(_._serialize_guard($scope3_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope3_id, "a", _._serialize_guard($scope3_reason, /* err.message */0))}</div>`);
        _._serialize_if($scope3_reason, /* err.message */0) && _._scope($scope3_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("d0", () => {
        _._scope_id();
        _._html("<div>Wird geladen...</div>");
      }, $scope0_id)
    })
  });
});

const _inlineForm = _._template("f", input => {
  const $scope0_id = _._scope_id();
  _._html("<div class=ck-form-wrapper><form action=https://app.kit.com/forms/8825776/subscriptions method=post class=ck-form data-sv-form=8825776><div class=\"ck-alert ck-error\" hidden>Please fill all required fields correctly!</div><div class=\"ck-alert ck-success\" hidden>Thank you for subscribing! Check your inbox (or spam folder) to confirm your subscription.</div><div class=\"ck-alert ck-loading\" hidden>Submitting...</div><h2 class=ck-title>Get the weekly newsletter!</h2><div class=ck-fields><input name=fields[first_name] type=text class=ck-input placeholder=\"Your first name\" required><input name=email_address type=email class=ck-input placeholder=\"Your email address\" required><button type=submit class=ck-submit>Sign up</button></div></form></div>");
  _._script($scope0_id, "f0");
});

const fetchPost = async slug => {
  const postRes = await pb.collection("posts").getFirstListItem(`slug="${slug}"`, {
    expand: "tags"
  });
  if (!postRes) {
    throw new Error("Beitrag nicht gefunden");
  }
  return {
    post: postRes
  };
};
const Page$4 = _._template("l", input => {
  const $scope0_id = _._scope_id();
  _._try($scope0_id, "a", _._content_resume("l2", () => {
    const $scope1_id = _._scope_id();
    _._await($scope1_id, "a", fetchPost(_.$global().url.pathname.split("/").pop()), data => {
      _._scope_id();
      _._html("<div class=wrapper>");
      _aside({});
      _._html(`<div class=article-wrapper><article><h1>${_._escape(data.post.title)}</h1><small>${_._escape(new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(new Date(data.post.created)))}</small><div class=cover><img aria-label="Post Cover"${_._attr("src", `http://127.0.0.1:8090/api/files/${data.post.collectionId}/${data.post.id}/${data.post.cover}`)} width=100%></div><div class=content>`);
      _inlineForm({});
      _._html(`${_._unescaped(data.post.content)}</div></article></div></div>`);
    }, 0);
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("l1", err => {
        const $scope3_reason = _._scope_reason();
        const $scope3_id = _._scope_id();
        _._html("<div class=wrapper>");
        _aside({});
        _._html(`<article><h5>It looks like this post doesn't exist: ${_._sep(_._serialize_guard($scope3_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope3_id, "b", _._serialize_guard($scope3_reason, /* err.message */0))}</h5><a href="/">Go back to home</a></article></div>`);
        _._serialize_if($scope3_reason, /* err.message */0) && _._scope($scope3_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("l0", () => {
        _._scope_id();
        _._html("<article><p>Loading\u2026</p><div></div></article>");
      }, $scope0_id)
    })
  });
  _._html("<script data-goatcounter=https://arnoldgunter.goatcounter.com/count async src=//gc.zgo.at/count.js></script>");
});

const Template$4 = _._template("ceS3l6b", input => {
  _._scope_id();
  Layout1({
    content: _._content("PN6WCqo", () => {
      _._scope_id();
      Page$4({});
    })
  });
});

function flush$4($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush$4($global) {
  $global.__flush__ = flush$4;
}
const page$3 = _._template("v3CyvmQ", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), ["post_HYoN"]) || setFlush$4(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template$4({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const pageTitle$3 = "Arnold Gunter | Web Development & Tech Blog";
const pageDescription$3 = "Stay ahead in web development and tech with Arnold Gunter. Explore tutorials, programming guides, insights on React, Next.js, Marko.js, TypeScript, TailwindCSS, and more.";
const pageKeywords$3 = "Arnold Gunter, Web Development, Programming, React, Next.js, Marko.js, TypeScript, TailwindCSS, Software Development, Coding Tutorials, Tech Blog, Developer Insights";
const meta3 = {
  pageTitle: pageTitle$3,
  pageDescription: pageDescription$3,
  pageKeywords: pageKeywords$3,
};

// virtual:marko-run__marko-run__post.$.js

function get3(context) {
	return context.render(page$3, {});
}

function head3(context) {
	return stripResponseBody(get3(context));
}

const Page$3 = _._template("j", input => {
  _._scope_id();
  _._html("<div class=privacy-policy><h2>Privacy Policy</h2><h3>Email Subscriptions</h3><p>We use <a href=\"https://kit.com/\">ConvertKit</a> to manage newsletter subscriptions. When you sign up via our form, ConvertKit collects your name and email address. This data is stored on ConvertKit\u2019s servers and used solely for sending you the newsletter and related updates. You can unsubscribe at any time via the link in our emails.</p><h3>Analytics</h3><p>We use <a href=\"https://www.goatcounter.com/\">GoatCounter</a> to count page views and understand general traffic patterns. GoatCounter collects anonymized data such as your IP address (masked), browser, device type, and page visited. This data is not used to identify you personally and is solely for website analytics.</p><h3>No Other Data Collection</h3><p>We do not sell, share, or process any other personal data. We do not use cookies or tracking scripts beyond the services mentioned above.</p><h3>Your Rights</h3><p>You can request access to or deletion of your data from our newsletter provider (ConvertKit) at any time. For analytics data, GoatCounter already anonymizes and protects your privacy by default.</p><h3>Changes to This Policy</h3><p>We may update this Privacy Policy occasionally to reflect changes in services or legal requirements. The latest version will always be available on this page.</p><h3>Contact</h3><p>If you have any questions regarding privacy, you can contact us at: <a href=mailto:arnoldgunter@uncropped.media>arnoldgunter@uncropped.media</a></p></div>");
});

const Template$3 = _._template("GONVWJp", input => {
  _._scope_id();
  Layout1({
    content: _._content("LHnChu1", () => {
      _._scope_id();
      Page$3({});
    })
  });
});

function flush$3($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush$3($global) {
  $global.__flush__ = flush$3;
}
const page$2 = _._template("I_DYPjA", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), ["privacy_LMbl"]) || setFlush$3(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template$3({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const pageTitle$2 = "Arnold Gunter | Privacy Policy";
const pageDescription$2 = "Read Arnold Gunter's Privacy Policy to understand how your data is collected, used, and protected while using the web development and tech blog.";
const pageKeywords$2 = "Arnold Gunter, Privacy Policy, Data Protection, Web Development Blog, Tech Blog, User Data";
const meta4 = {
  pageTitle: pageTitle$2,
  pageDescription: pageDescription$2,
  pageKeywords: pageKeywords$2,
};

// virtual:marko-run__marko-run__privacy.js

function get4(context) {
	return context.render(page$2, {});
}

function head4(context) {
	return stripResponseBody(get4(context));
}

const fetchPosts = async query => {
  const results = await pb.collection("posts").getList(1, 50, {
    filter: `title~"${query}"`,
    sort: "-created"
  });
  return results.items;
};
const Page$2 = _._template("k", input => {
  const $scope0_id = _._scope_id();
  _._html(`<div class=posts><h2>Search results for: "${_._escape(_.$global().url.searchParams.get("q"))}"</h2>`);
  _._try($scope0_id, "b", _._content_resume("k2", () => {
    const $scope1_id = _._scope_id();
    _._await($scope1_id, "a", fetchPosts(_.$global().url.searchParams.get("q")), data => {
      _._scope_id();
      if (data.length === 0) {
        _._scope_id();
        _._html(`<p>No results for "${_._escape(_.$global().url.searchParams.get("q"))}" found. Go back and try a different search.</p>`);
      }
      _.forOf(data, post => {
        _._scope_id();
        _._html(`<a${_._attr("href", `/post/${post.slug}`)} class=post><span class=post-content><small>${_._escape(new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        }).format(new Date(post.created)))}</small><h5>${_._escape(post.title)}</h5><p>${_._escape(post.subtitle)}</p></span><img${_._attr("src", `http://127.0.0.1:8090/api/files/${post.collectionId}/${post.id}/${post.cover}?thumb=300x150`)}${_._attr("alt", `${post.title}`)} class=post-image></a>`);
      });
    }, 0);
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("k1", err => {
        const $scope3_reason = _._scope_reason();
        const $scope3_id = _._scope_id();
        _._html(`<div class=error>Error fetching search results: ${_._sep(_._serialize_guard($scope3_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope3_id, "a", _._serialize_guard($scope3_reason, /* err.message */0))}</div>`);
        _._serialize_if($scope3_reason, /* err.message */0) && _._scope($scope3_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("k0", () => {
        _._scope_id();
        _._html("<div>Loading search results...</div>");
      }, $scope0_id)
    })
  });
  _._html("</div>");
});

const Template$2 = _._template("tAgzgoy", input => {
  _._scope_id();
  Layout1({
    content: _._content("bM8Nuzc", () => {
      _._scope_id();
      Page$2({});
    })
  });
});

function flush$2($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush$2($global) {
  $global.__flush__ = flush$2;
}
const page$1 = _._template("gnyGc22", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), ["search_C6Cw"]) || setFlush$2(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template$2({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const pageTitle$1 = "Arnold Gunter | Search Results";
const pageDescription$1 = "Search through Arnold Gunter's web development and tech blog for tutorials, programming guides, and insights on React, Next.js, Marko.js, TypeScript, TailwindCSS, and more.";
const pageKeywords$1 = "Arnold Gunter, Web Development, Programming, React, Next.js, Marko.js, TypeScript, TailwindCSS, Software Development, Coding Tutorials, Tech Blog, Developer Insights";
const meta5 = {
  pageTitle: pageTitle$1,
  pageDescription: pageDescription$1,
  pageKeywords: pageKeywords$1,
};

// virtual:marko-run__marko-run__search.js

function get5(context) {
	return context.render(page$1, {});
}

function head5(context) {
	return stripResponseBody(get5(context));
}

const fetchPostsByTag = async tagSlug => {
  const tagRecords = await pb.collection("tags").getFullList(1, {
    filter: `slug="${tagSlug}"`
  });
  if (tagRecords.length === 0) {
    throw new Error("Tag not found");
  }
  const tagId = tagRecords[0].id;
  const postsRes = await pb.collection("posts").getFullList({
    filter: `tags~"${tagId}"`,
    sort: "-created",
    fields: "id,collectionId,collectionName,title,slug,created,cover,subtitle"
  });
  return {
    posts: postsRes
  };
};
const Page$1 = _._template("m", input => {
  const $scope0_id = _._scope_id();
  _._try($scope0_id, "a", _._content_resume("m2", () => {
    const $scope1_id = _._scope_id();
    _._html(`<div class=posts><h2>Posts for tag: ${_._escape(_.$global().url.pathname.split("/").pop())}</h2>`);
    _._await($scope1_id, "b", fetchPostsByTag(_.$global().url.pathname.split("/").pop()), data => {
      _._scope_id();
      _.forOf(data.posts, post => {
        _._scope_id();
        _._html(`<a${_._attr("href", `/post/${post.slug}`)} class=post><span class=post-content><small>${_._escape(new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        }).format(new Date(post.created)))}</small><h5>${_._escape(post.title)}</h5><p>${_._escape(post.subtitle)}</p></span><img${_._attr("src", `http://127.0.0.1:8090/api/files/${post.collectionId}/${post.id}/${post.cover}?thumb=300x150`)}${_._attr("alt", `${post.title}`)} class=post-image></a>`);
      });
    }, 0);
    _._html("</div>");
  }, $scope0_id), {
    catch: _.attrTag({
      content: _._content_resume("m1", err => {
        const $scope3_reason = _._scope_reason();
        const $scope3_id = _._scope_id();
        _._html(`<div class=posts><h5>Error: ${_._sep(_._serialize_guard($scope3_reason, /* err.message */0))}${_._escape(err.message)}${_._el_resume($scope3_id, "a", _._serialize_guard($scope3_reason, /* err.message */0))}</h5><p><a href="/">Go back to home</a> or check out one of the other tags and posts below!</p>`);
        _aside({});
        _._html("</div>");
        _._serialize_if($scope3_reason, /* err.message */0) && _._scope($scope3_id, {});
      }, $scope0_id)
    }),
    placeholder: _.attrTag({
      content: _._content_resume("m0", () => {
        _._scope_id();
        _._html("<div class=posts><h2>Loading\u2026</h2><div></div></div>");
      }, $scope0_id)
    })
  });
});

const Template$1 = _._template("zoFw0Mb", input => {
  _._scope_id();
  Layout1({
    content: _._content("p2y$xeP", () => {
      _._scope_id();
      Page$1({});
    })
  });
});

function flush$1($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush$1($global) {
  $global.__flush__ = flush$1;
}
const page = _._template("yRZL19$", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), ["tag_oS8d"]) || setFlush$1(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template$1({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const pageTitle = "Arnold Gunter | Tags";
const pageDescription = "Explore articles and tutorials categorized under specific tags on Arnold Gunter's web development and tech blog. Find content on React, Next.js, Marko.js, TypeScript, TailwindCSS, and more.";
const pageKeywords = "Arnold Gunter, Tags, Web Development, Programming, React, Next.js, Marko.js, TypeScript, TailwindCSS, Software Development, Coding Tutorials, Tech Blog, Developer Insights";
const meta6 = {
  pageTitle,
  pageDescription,
  pageKeywords,
};

// virtual:marko-run__marko-run__tag.$.js

function get6(context) {
	return context.render(page, {});
}

function head6(context) {
	return stripResponseBody(get6(context));
}

const Page = _._template("a", input => {
  _._scope_id();
  _._html("<div><h1>404 - Site not found</h1><p>The requested page could not be found.</p><a href=\"/\">Go back to homepage</a></div>");
});

const Template = _._template("NKgb_ER", input => {
  _._scope_id();
  Layout1({
    content: _._content("riCeUAt", () => {
      _._scope_id();
      Page({});
    })
  });
});

function flush($global, html) {
  return getPrepend($global) + html + getAppend($global);
}
function setFlush($global) {
  $global.__flush__ = flush;
}
const page404 = _._template("usC9DUp", input => {
  _._scope_id();
  const writeSync = addAssets(_.$global(), ["404_MrOC"]) || setFlush(_.$global());
  _._html(_._unescaped(writeSync && getPrepend(_.$global())));
  Template({});
  _._html(_._unescaped(writeSync && getAppend(_.$global())));
});

const page404ResponseInit = {
  status: 404,
  headers: { "content-type": "text/html;charset=UTF-8" }
};
globalThis.__marko_run__ = { match, fetch, invoke };
function match(method, pathname) {
  const last = pathname.length - 1;
  return match_internal(method, last && pathname.charAt(last) === "/" ? pathname.slice(0, last) : pathname);
}
function match_internal(method, pathname) {
  const len = pathname.length;
  switch (method) {
    case "GET":
    case "get": {
      if (len === 1) return { handler: get2, params: {}, meta: meta2, path: "/" };
      const i1 = pathname.indexOf("/", 1) + 1;
      if (!i1 || i1 === len) {
        switch (pathname.slice(1, i1 ? -1 : len)) {
          case "privacy":
            return { handler: get4, params: {}, meta: meta4, path: "/privacy" };
          case "search":
            return { handler: get5, params: {}, meta: meta5, path: "/search" };
        }
      } else {
        switch (pathname.slice(1, i1 - 1)) {
          case "post":
            {
              const i2 = pathname.indexOf("/", 6) + 1;
              if (!i2 || i2 === len) {
                const s2 = decodeURIComponent(pathname.slice(6, i2 ? -1 : len));
                if (s2) return { handler: get3, params: { slug: s2 }, meta: meta3, path: "/post/$slug" };
              }
            }
            break;
          case "tag":
            {
              const i2 = pathname.indexOf("/", 5) + 1;
              if (!i2 || i2 === len) {
                const s2 = decodeURIComponent(pathname.slice(5, i2 ? -1 : len));
                if (s2) return { handler: get6, params: { slug: s2 }, meta: meta6, path: "/tag/$slug" };
              }
            }
            break;
        }
      }
      return null;
    }
    case "HEAD":
    case "head": {
      if (len === 1) return { handler: head2, params: {}, meta: meta2, path: "/" };
      const i1 = pathname.indexOf("/", 1) + 1;
      if (!i1 || i1 === len) {
        switch (pathname.slice(1, i1 ? -1 : len)) {
          case "privacy":
            return { handler: head4, params: {}, meta: meta4, path: "/privacy" };
          case "search":
            return { handler: head5, params: {}, meta: meta5, path: "/search" };
        }
      } else {
        switch (pathname.slice(1, i1 - 1)) {
          case "post":
            {
              const i2 = pathname.indexOf("/", 6) + 1;
              if (!i2 || i2 === len) {
                const s2 = decodeURIComponent(pathname.slice(6, i2 ? -1 : len));
                if (s2) return { handler: head3, params: { slug: s2 }, meta: meta3, path: "/post/$slug" };
              }
            }
            break;
          case "tag":
            {
              const i2 = pathname.indexOf("/", 5) + 1;
              if (!i2 || i2 === len) {
                const s2 = decodeURIComponent(pathname.slice(5, i2 ? -1 : len));
                if (s2) return { handler: head6, params: { slug: s2 }, meta: meta6, path: "/tag/$slug" };
              }
            }
            break;
        }
      }
      return null;
    }
  }
  return null;
}
async function invoke(route, request, platform, url) {
  const context = createContext(route, request, platform, url);
  if (route) {
    try {
      const response = await route.handler(context);
      if (response) return response;
    } catch (error) {
      if (error === NotHandled) return;
      if (error !== NotMatched) throw error;
    }
  }
  if (context.request.headers.get("Accept")?.includes("text/html")) {
    return context.render(page404, {}, page404ResponseInit);
  }
  return new Response(null, {
    status: 404
  });
}
async function fetch(request, platform) {
  try {
    const url = new URL(request.url);
    const { pathname } = url;
    const last = pathname.length - 1;
    const hasTrailingSlash = last && pathname.charAt(last) === "/";
    const normalizedPathname = hasTrailingSlash ? pathname.slice(0, last) : pathname;
    const route = match_internal(request.method, normalizedPathname);
    if (route && hasTrailingSlash) {
      url.pathname = normalizedPathname;
      return Response.redirect(url);
    }
    return await invoke(route, request, platform, url);
  } catch (error) {
    return new Response(null, {
      status: 500
    });
  }
}

const __dirname$1 = dirname(fileURLToPath(import.meta.url));

const { PORT = 3000 } = process.env;

const middleware = createMiddleware(fetch);
const compress = compression({
  flush: zlib.constants.Z_PARTIAL_FLUSH,
  threshold: 500,
});

const servePublic = createStaticServe(`${__dirname$1}/public`, {
  index: false,
  redirect: false,
  maxAge: "10 minutes",
});

const serveAssets = createStaticServe(`${__dirname$1}/public/assets`, {
  index: false,
  redirect: false,
  immutable: true,
  fallthrough: false,
  maxAge: "365 days",
});

createServer((req, res) =>
  compress(req, res, () => {
    if (req.url.startsWith("/assets/")) {
      req.url = req.url.slice(7);
      serveAssets(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    } else {
      servePublic(req, res, () => middleware(req, res));
    }
  }),
).listen(PORT);
;var __MARKO_MANIFEST__={"404_MrOC":{"head-prepend":null,"head":[2,"stylesheet#/assets/404-DhfIxiuk.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/404-DhfIxiuk.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null},"post_HYoN":{"head-prepend":null,"head":[2,"/assets/post._-DzXcgujU.js",6,"<script",0," async type=\"module\" crossorigin src=\"",1,"assets/post._-DzXcgujU.js\"","></script>",2,"modulepreload#/assets/_Bi94Orki.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_Bi94Orki.js\"",">",2,"modulepreload#/assets/_BmhvfK02.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_BmhvfK02.js\"",">",2,"stylesheet#/assets/aside-BE4L6le2.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/aside-BE4L6le2.css\"",">",2,"stylesheet#/assets/post._-B8WZfrHQ.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/post._-B8WZfrHQ.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null},".marko-run_1v7P":{"head-prepend":null,"head":[2,"/assets/index-h2LqK5I5.js",6,"<script",0," async type=\"module\" crossorigin src=\"",1,"assets/index-h2LqK5I5.js\"","></script>",2,"modulepreload#/assets/_Bi94Orki.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_Bi94Orki.js\"",">",2,"stylesheet#/assets/index-DLBl1PU0.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/index-DLBl1PU0.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null},"search_C6Cw":{"head-prepend":null,"head":[2,"/assets/search-DfBYeg5I.js",6,"<script",0," async type=\"module\" crossorigin src=\"",1,"assets/search-DfBYeg5I.js\"","></script>",2,"modulepreload#/assets/_Bi94Orki.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_Bi94Orki.js\"",">",2,"stylesheet#/assets/search-C3kWFaZs.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/search-C3kWFaZs.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null},"privacy_LMbl":{"head-prepend":null,"head":[2,"stylesheet#/assets/privacy-_i5iJjoW.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/privacy-_i5iJjoW.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null},"tag_oS8d":{"head-prepend":null,"head":[2,"/assets/tag._-DjGmQonb.js",6,"<script",0," async type=\"module\" crossorigin src=\"",1,"assets/tag._-DjGmQonb.js\"","></script>",2,"modulepreload#/assets/_Bi94Orki.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_Bi94Orki.js\"",">",2,"modulepreload#/assets/_BmhvfK02.js",6,"<link",0," rel=\"modulepreload\" crossorigin href=\"",1,"assets/_BmhvfK02.js\"",">",2,"stylesheet#/assets/aside-BE4L6le2.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/aside-BE4L6le2.css\"",">",2,"stylesheet#/assets/search-C3kWFaZs.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/search-C3kWFaZs.css\"",">",2,"stylesheet#/assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css",6,"<link",0," rel=\"stylesheet\" crossorigin href=\"",1,"assets/_layout.marko_marko-virtual_id_._2F_2Blayout-zz95P0vU.css\"",">"],"body-prepend":null,"body":null}};
