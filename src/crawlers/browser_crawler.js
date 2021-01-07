import ow from 'ow';
import _ from 'underscore';
import { BrowserPool } from 'browser-pool'; // eslint-disable-line import/no-duplicates
import { BASIC_CRAWLER_TIMEOUT_MULTIPLIER } from '../constants';
import { SessionPool } from '../session_pool/session_pool'; // eslint-disable-line import/no-duplicates
import EVENTS from '../session_pool/events'; // eslint-disable-line import/no-duplicates
import { addTimeoutToPromise } from '../utils';
import BasicCrawler from './basic_crawler'; // eslint-disable-line import/no-duplicates
import { validators } from '../validators';
import {
    throwOnBlockedRequest,
} from './crawler_utils';

// eslint-enable-line import/no-duplicates

/**
 * @typedef BrowserCrawlerOptions
 * @property {function} handlePageFunction
 *   Function that is called to process each request.
 *   It is passed an object with the following fields:
 *
 * ```
 * {
 *   request: Request,
 *   response: Response,
 *   page: Page,
 *   session: Session,
 *   browserController: BrowserController,
 *   proxyInfo: ProxyInfo,
 *   crawler: BrowserCrawler,
 * }
 * ```
 *
 *   `request` is an instance of the {@link Request} object with details about the URL to open, HTTP method etc.
 *   `page` is an instance of the `Puppeteer`
 *   [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page) or `Playwright`
 *   [`Page`](https://playwright.dev/docs/api/class-page)
 *   `browserPool` is an instance of the
 *   [`BrowserPool`](https://github.com/apify/browser-pool#BrowserPool),
 *   `browserController` is an instance of the
 *   [`BrowserController`](https://github.com/apify/browser-pool#browsercontroller),
 *   `response` is an instance of the `Puppeteer`
 *   [`Response`](https://pptr.dev/#?product=Puppeteer&show=api-class-response) or `Playwright`
 *   [`Response`](https://playwright.dev/docs/api/class-response),
 *   which is the main resource response as returned by `page.goto(request.url)`.
 *   The function must return a promise, which is then awaited by the crawler.
 *
 *   If the function throws an exception, the crawler will try to re-crawl the
 *   request later, up to `option.maxRequestRetries` times.
 *   If all the retries fail, the crawler calls the function
 *   provided to the `handleFailedRequestFunction` parameter.
 *   To make this work, you should **always**
 *   let your function throw exceptions rather than catch them.
 *   The exceptions are logged to the request using the
 *   {@link Request#pushErrorMessage} function.
 * @property {number} [handlePageTimeoutSecs=60]
 *   Timeout in which the function passed as `handlePageFunction` needs to finish, in seconds.
 * @property {function} [gotoFunction]
 *   Navigation function for corresponding library. `page.goto(url)` is supported by both `playwright` and `puppeteer`.
 * @property {HandleFailedRequest} [handleFailedRequestFunction]
 *   A function to handle requests that failed more than `option.maxRequestRetries` times.
 *
 *   The function receives the following object as an argument:
 * ```
 * {
 *   request: Request,
 *   response: Response,
 *   page: Page,
 *   browserPool: BrowserPool,
 *   autoscaledPool: AutoscaledPool,
 *   session: Session,
 *   browserController: BrowserController,
 *   proxyInfo: ProxyInfo,
 * }
 * ```
 *   Where the {@link Request} instance corresponds to the failed request, and the `Error` instance
 *   represents the last error thrown during processing of the request.
* @property {BrowserPoolOptions} [browserPoolOptions]
 *   Custom options passed to the underlying [`BrowserPool`](https://github.com/apify/browser-pool#BrowserPool) constructor.
 *   You can tweak those to fine-tune browser management.
 * @property {boolean} [persistCookiesPerSession=false]
 *   Automatically saves cookies to Session. Works only if Session Pool is used.
 * @property {ProxyConfiguration} [proxyConfiguration]
 *   If set, `PuppeteerCrawler` will be configured for all connections to use
 *   [Apify Proxy](https://my.apify.com/proxy) or your own Proxy URLs provided and rotated according to the configuration.
 *   For more information, see the [documentation](https://docs.apify.com/proxy).
 * @property {Array<function>} [preNavigationHooks]
 *   Async functions that are sequentially evaluated before the navigation. Good for setting additional cookies
 *   or browser properties before navigation. The function accepts two parameters, `crawlingContext` and `gotoOptions`,
 *   which are passed to the `gotoFunction` the crawler calls to navigate.
 *   Example:
 * ```
 * preNavigationHooks: [
 *     async (crawlingContext, gotoOptions) => {
 *         await page.evaluate((attr) => { window.foo = attr; }, 'bar');
 *     }
 * ]
 * ```
 * @property {Array<function>} [postNavigationHooks]
 *   Async functions that are sequentially evaluated after the navigation. Good for checking if the navigation was successful.
 *   The function accepts `crawlingContext` as an only parameter.
 *   Example:
 * ```
 * postNavigationHooks: [
 *     async (crawlingContext) => {
 *         const { page } = crawlingContext;
 *         if (hasCaptcha(page)) {
 *             await solveCaptcha (page);
 *         }
 *     };
 * ]
 * ```
 * @property {RequestList} [requestList]
 *   Static list of URLs to be processed.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @property {RequestQueue} [requestQueue]
 *   Dynamic queue of URLs to be processed. This is useful for recursive crawling of websites.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @property {number} [handleRequestTimeoutSecs=60]
 *   Timeout in which the function passed as `handleRequestFunction` needs to finish, in seconds.
 * @property {HandleFailedRequest} [handleFailedRequestFunction]
 *   A function to handle requests that failed more than `option.maxRequestRetries` times.
 *
 *   The function receives the following object as an argument:
 * ```
 * {
 *   request: Request,
 *   error: Error,
 *   session: Session,
 *   crawler: BrowserCrawler,
 * }
 * ```
 *   where the {@link Request} instance corresponds to the failed request, and the `Error` instance
 *   represents the last error thrown during processing of the request.
 *
 *   See
 *   [source code](https://github.com/apify/apify-js/blob/master/src/crawlers/basic_crawler.js#L11)
 *   for the default implementation of this function.
 * @property {number} [maxRequestRetries=3]
 *   Indicates how many times the request is retried if {@link BasicCrawlerOptions.handleRequestFunction} fails.
 * @property {number} [maxRequestsPerCrawl]
 *   Maximum number of pages that the crawler will open. The crawl will stop when this limit is reached.
 *   Always set this value in order to prevent infinite loops in misconfigured crawlers.
 *   Note that in cases of parallel crawling, the actual number of pages visited might be slightly higher than this value.
 * @property {AutoscaledPoolOptions} [autoscaledPoolOptions]
 *   Custom options passed to the underlying {@link AutoscaledPool} constructor.
 *   Note that the `runTaskFunction` and `isTaskReadyFunction` options
 *   are provided by `BasicCrawler` and cannot be overridden.
 *   However, you can provide a custom implementation of `isFinishedFunction`.
 * @property {number} [minConcurrency=1]
 *   Sets the minimum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
 *
 *   *WARNING:* If you set this value too high with respect to the available system memory and CPU, your crawler will run extremely slow or crash.
 *   If you're not sure, just keep the default value and the concurrency will scale up automatically.
 * @property {number} [maxConcurrency=1000]
 *   Sets the maximum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
 * @property {boolean} [useSessionPool=false]
 *   If set to true. Basic crawler will initialize the  {@link SessionPool} with the corresponding `sessionPoolOptions`.
 *   The session instance will be than available in the `handleRequestFunction`.
 * @property {SessionPoolOptions} [sessionPoolOptions] The configuration options for {@link SessionPool} to use.
 */

/**
 * Provides a simple framework for parallel crawling of web pages
 * using headless browsers with [Puppeteer](https://github.com/puppeteer/puppeteer)
 * and [Playwright](https://github.com/microsoft/playwright).
 * The URLs to crawl are fed either from a static list of URLs
 * or from a dynamic queue of URLs enabling recursive crawling of websites.
 *
 * Since `BrowserCrawler` uses headless or even headfull browsers to download web pages and extract data,
 * it is useful for crawling of websites that require to execute JavaScript.
 * If the target website doesn't need JavaScript, consider using {@link CheerioCrawler},
 * which downloads the pages using raw HTTP requests and is about 10x faster. @TODO: more?
 *
 * The source URLs are represented using {@link Request} objects that are fed from
 * {@link RequestList} or {@link RequestQueue} instances provided by the {@link BrowserCrawlerOptions.requestList}
 * or {@link BrowserCrawlerOptions.requestQueue} constructor options, respectively.
 *
 * If both {@link BrowserCrawlerOptions.requestList} and {@link BrowserCrawlerOptions.requestQueue} are used,
 * the instance first processes URLs from the {@link RequestList} and automatically enqueues all of them
 * to {@link RequestQueue} before it starts their processing. This ensures that a single URL is not crawled multiple times.
 *
 * The crawler finishes when there are no more {@link Request} objects to crawl.
 *
 * `BrowserCrawler` opens a new browser page (i.e. tab or window) for each {@link Request} object to crawl
 * and then calls the function provided by user as the {@link BrowserCrawlerOptions.handlePageFunction} option.
 *
 * New pages are only opened when there is enough free CPU and memory available,
 * using the functionality provided by the {@link AutoscaledPool} class.
 * All {@link AutoscaledPool} configuration options can be passed to the {@link BrowserCrawlerOptions.autoscaledPoolOptions}
 * parameter of the `BrowserCrawler` constructor. For user convenience, the `minConcurrency` and `maxConcurrency`
 * {@link AutoscaledPoolOptions} are available directly in the `BrowserCrawler` constructor.
 *
 * Note that the pool of browser instances is internally managed by the {@link BrowserPool} class.
 *
 * **Example usage:**
 * @TODO:
 * ```javascript
 * const crawler = new Apify.PuppeteerCrawler({
 *     requestList,
 *     handlePageFunction: async ({ page, request }) => {
 *         // This function is called to extract data from a single web page
 *         // 'page' is an instance of Puppeteer.Page with page.goto(request.url) already called
 *         // 'request' is an instance of Request class with information about the page to load
 *         await Apify.pushData({
 *             title: await page.title(),
 *             url: request.url,
 *             succeeded: true,
 *         })
 *     },
 *     handleFailedRequestFunction: async ({ request }) => {
 *         // This function is called when the crawling of a request failed too many times
 *         await Apify.pushData({
 *             url: request.url,
 *             succeeded: false,
 *             errors: request.errorMessages,
 *         })
 *     },
 * });
 *
 * await crawler.run();
 * ```
 * @property {Statistics} stats
 *  Contains statistics about the current run.
 * @property {?RequestList} requestList
 *  A reference to the underlying {@link RequestList} class that manages the crawler's {@link Request}s.
 *  Only available if used by the crawler.
 * @property {?RequestQueue} requestQueue
 *  A reference to the underlying {@link RequestQueue} class that manages the crawler's {@link Request}s.
 *  Only available if used by the crawler.
 * @property {?SessionPool} sessionPool
 *  A reference to the underlying {@link SessionPool} class that manages the crawler's {@link Session}s.
 *  Only available if used by the crawler.
 * @property {?ProxyConfiguration} proxyConfiguration
 *  A reference to the underlying {@link ProxyConfiguration} class that manages the crawler's proxies.
 *  Only available if used by the crawler.
 * @property {BrowserPool} browserPool
 *  A reference to the underlying `BrowserPool` class that manages the crawler's browsers.
 *  For more information about it, see the [`browser-pool` module](https://github.com/apify/browser-pool).
 * @property {AutoscaledPool} autoscaledPool
 *  A reference to the underlying {@link AutoscaledPool} class that manages the concurrency of the crawler.
 *  Note that this property is only initialized after calling the {@link CheerioCrawler#run} function.
 *  You can use it to change the concurrency settings on the fly,
 *  to pause the crawler by calling {@link AutoscaledPool#pause}
 *  or to abort it by calling {@link AutoscaledPool#abort}.
 */
class BrowserCrawler extends BasicCrawler {
    static optionsShape = {
        ...BasicCrawler.optionsShape,
        // TODO temporary until the API is unified in V2
        handleRequestFunction: ow.undefined,

        handlePageFunction: ow.function,
        gotoFunction: ow.optional.function,

        handlePageTimeoutSecs: ow.optional.number,
        preNavigationHooks: ow.optional.array,
        postNavigationHooks: ow.optional.array,

        browserPoolOptions: ow.object,
        sessionPoolOptions: ow.optional.object,
        persistCookiesPerSession: ow.optional.boolean,
        useSessionPool: ow.optional.boolean,
        proxyConfiguration: ow.optional.object.validate(validators.proxyConfiguration),
    };

    /**
   * @param {BrowserCrawlerOptions} options
   * All `BrowserCrawler` parameters are passed via an options object.
   */
    constructor(options) {
        ow(options, 'BrowserCrawlerOptions', ow.object.exactShape(BrowserCrawler.optionsShape));
        const {
            handlePageFunction,
            handlePageTimeoutSecs = 60,
            gotoFunction,
            persistCookiesPerSession = true,
            useSessionPool = true,
            sessionPoolOptions,
            proxyConfiguration,
            browserPoolOptions,
            preNavigationHooks = [],
            postNavigationHooks = [],
            ...basicCrawlerOptions
        } = options;

        if (!useSessionPool && persistCookiesPerSession) {
            // @TODO: Maybe we could also automatically set persistCookiesPerSession to false when useSessionPool is false and log warning
            throw new Error('You cannot use "persistCookiesPerSession" without "useSessionPool" set to true.');
        }

        super({
            ...basicCrawlerOptions,
            useSessionPool: false,
            handleRequestFunction: (...args) => this._handleRequestFunction(...args),
            handleRequestTimeoutSecs: handlePageTimeoutSecs * BASIC_CRAWLER_TIMEOUT_MULTIPLIER,
        });

        this.handlePageFunction = handlePageFunction;
        this.handlePageTimeoutSecs = handlePageTimeoutSecs;
        this.handlePageTimeoutMillis = this.handlePageTimeoutSecs * 1000;

        this.gotoFunction = gotoFunction;
        this.gotoOptions = {};

        this.persistCookiesPerSession = persistCookiesPerSession;
        this.proxyConfiguration = proxyConfiguration;

        this.preNavigationHooks = preNavigationHooks;
        this.postNavigationHooks = postNavigationHooks;

        if (useSessionPool) {
            this.sessionPool = new SessionPool({
                ...sessionPoolOptions,
                log: this.log,
            });

            // Assuming there are not more thant 20 browsers running at once;
            this.sessionPool.setMaxListeners(20);
        }

        const { preLaunchHooks = [], postLaunchHooks = [], ...rest } = browserPoolOptions;
        this.browserPool = new BrowserPool({
            ...rest,
            preLaunchHooks: [
                this._extendLaunchContext.bind(this),
                ...preLaunchHooks,
            ],
            postLaunchHooks: [
                this._maybeAddSessionRetiredListener.bind(this),
                ...postLaunchHooks,
            ],
        });
    }

    /**
     * Wrapper around handlePageFunction that opens and closes pages etc.
     *
     * @param {Object} crawlingContext
     * @param {Request} crawlingContext.request
     * @param {BrowserController} crawlingContext.browserController
     * @param {Session} [crawlingContext.session]
     * @private
     */
    async _handleRequestFunction(crawlingContext) {
        const { id } = crawlingContext;
        const page = await this.browserPool.newPage({ id });
        this._enhanceCrawlingContextWithPageInfo(crawlingContext, page);

        const { request, session } = crawlingContext;

        if (this.persistCookiesPerSession) {
            const cookies = crawlingContext.session.getPuppeteerCookies(request.url);
            await crawlingContext.browserController.setCookies(page, cookies);
        }

        try {
            await this._handleNavigation(crawlingContext);

            await this._responseHandler(crawlingContext);

            // save cookies
            // @TODO: Should we save the cookies also after/only the handle page?
            if (this.persistCookiesPerSession) {
                const cookies = await crawlingContext.browserController.getCookies(page);
                session.setPuppeteerCookies(cookies, request.loadedUrl);
            }

            await addTimeoutToPromise(
                this.handlePageFunction(crawlingContext),
                this.handlePageTimeoutMillis,
                `handlePageFunction timed out after ${this.handlePageTimeoutMillis / 1000} seconds.`,
            );

            if (session) session.markGood();
        } finally {
            try {
                await page.close();
            } catch (error) {
                // Only log error in page close.
                this.log.debug('Error while closing page', { error });
            }
        }
    }

    /**
     *
     * @param {object} crawlingContext
     * @param {Page} page
     * @private
     */
    _enhanceCrawlingContextWithPageInfo(crawlingContext, page) {
        crawlingContext.page = page;

        // This is the wierd spam because of browser to proxy not page to proxy.
        const browserControllerInstance = this.browserPool.getBrowserControllerByPage(page);
        crawlingContext.browserController = browserControllerInstance;

        crawlingContext.session = browserControllerInstance.launchContext.session;
        crawlingContext.proxyInfo = browserControllerInstance.launchContext.proxyInfo;

        crawlingContext.crawler = this;
    }

    /**
     *
     * @param {object} crawlingContext
     * @private
     */
    async _handleNavigation(crawlingContext) {
        // @TODO: consider deep clone
        const gotoOptions = _.clone(this.gotoOptions);
        await this._executeHooks(this.preNavigationHooks, crawlingContext, gotoOptions);
        crawlingContext.response = await this._navigationHandler(crawlingContext, gotoOptions);

        await this._executeHooks(this.postNavigationHooks, crawlingContext, gotoOptions);
    }

    /**
     *
     * @param {object} crawlingContext
     * @param {object} gotoOptions
     * @private
     */
    async _navigationHandler(crawlingContext, gotoOptions) {
        if (!this.gotoFunction) {
            // @TODO: although it is optional in the validation,
            //  because when you make automation library specific you can override this handler.
            throw new Error('BrowserCrawler: You must specify a gotoFunction!');
        }
        return this.gotoFunction(crawlingContext, gotoOptions);
    }

    /**
     * Should be overriden in case of different automation library that does not support this response API.
     * // @TODO: This can be also done as a postNavigation hook except the loadedUrl marking.
     * @param crawlingContext
     * @return {Promise<void>}
     * @private
     */
    async _responseHandler(crawlingContext) {
        const { response, session, request, page } = crawlingContext;

        if (this.sessionPool && response) {
            if (typeof response === 'object' && typeof response.status === 'function') {
                throwOnBlockedRequest(session, response.status());
            } else {
                this.log.debug('Got a malformed Browser response.', { request, response });
            }
        }

        request.loadedUrl = await page.url();
    }

    /**
     *
     * @param {string} pageId
     * @param {object} launchContext
     * @private
     */
    async _extendLaunchContext(pageId, launchContext) {
        const launchContextExtends = {};

        if (this.sessionPool) {
            launchContextExtends.session = await this.sessionPool.getSession();
        }

        if (this.proxyConfiguration) {
            const proxyInfo = await this.proxyConfiguration.newProxyInfo(launchContextExtends.session && launchContextExtends.session.id);
            launchContext.proxyUrl = proxyInfo.url;
            launchContextExtends.proxyInfo = proxyInfo;
        }

        launchContext.extend(launchContextExtends);
    }

    /**
  *
  * @param {string} pageId
  * @param {BrowserController} browserController
  * @private
  */
    _maybeAddSessionRetiredListener(pageId, browserController) {
        if (this.sessionPool) {
            const listener = (session) => {
                const { launchContext } = browserController;
                if (session.id === launchContext.session.id) {
                    launchContext.extend({ sessionRetired: true }); // @TODO: kind of dirty trick done mainly for testing this important feature.
                    this.browserPool.retireBrowserController(browserController); //eslint-disable-line
                }
            };

            this.sessionPool.on(EVENTS.SESSION_RETIRED, listener);
            browserController.on('browserClosed', () => this.sessionPool.removeListener(EVENTS.SESSION_RETIRED, listener));
        }
    }

    /**
     *
     * @param {array} hooks
     * @param  {...any} args
     * @private
     */
    async _executeHooks(hooks, ...args) {
        if (Array.isArray(hooks) && hooks.length) {
            for (const hook of hooks) {
                await hook(...args);
            }
        }
    }

    /**
    * Function for cleaning up after all request are processed.
    * @ignore
    */
    async teardown() {
        await this.browserPool.destroy();
        super.teardown();
    }
}

export default BrowserCrawler;