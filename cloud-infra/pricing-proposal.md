# AWS App Monetization pricing proposal — review only

**Suggested beta plan:** one Demo subscription at $4.99/month, including five
cloud jobs per month. Further jobs are blocked until renewal. Local processing
remains available outside this cloud plan. There is no free GPU quota. This is a
proposal, not a published plan, and no payment setup has been run.

The value is access to cloud processing and larger models without a local GPU.
A short fixed allowance makes the cost predictable for both the user and the
beta operator. A subscription with a hard quota is a familiar shape for AI
creation tools; no current competitor prices were looked up.

For context, the AWS Price List API returned $1.861/hour for a `g6e.xlarge`
Linux On-Demand instance in `us-east-1` on 2026-10-11. Five jobs using five
minutes of GPU time each imply about $0.78 of instance compute. If each takes
15 minutes, instance compute is about $2.33. These figures omit start-up and
idle time, storage, web hosting, data transfer, payment fees, and tax. They are
not a forecast of margin or a required minimum price. Actual model speed and
resource use need measurement before publish.

Decisions for the app owner: final price, number of tiers, monthly included jobs,
whether image and text jobs share one quota, and target margin (including 0%).
The beta skill must receive explicit approval of the final pricing before it
creates plans or injects billing code.
