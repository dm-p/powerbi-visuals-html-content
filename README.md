# HTML Content for Power BI

By Daniel Marsh-Patrick

![github.png](./doc/assets/png/github.png "GitHub: dm-p") [dm-p](https://github.com/dm-p) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ![twitter.png](./doc/assets/png/twitter.png "Twitter: @the_d_mp") [@the_d_mp](https://twitter.com/the_d_mp) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;  ![linkedin.png](./doc/assets/png/linkedin.png "in/daniel-m-p") [daniel-m-p](https://www.linkedin.com/in/daniel-m-p)  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; www.coacervo.co  |  [daniel@coacervo.co](mailto:daniel@coacervo.co) 

----
**Home** | [Release Notes](./doc/release_notes.md) | [Usage](./doc/usage.md) | [Privacy Policy](./doc/privacy_policy.md)

----
## [Available in the Power BI Visuals Marketplace](https://appsource.microsoft.com/en-us/product/power-bi-visuals/WA200001930)

Because there is a delay in publishing to the marketplace, a standalone copy of the latest version of the visual is available from the repository's releases page. Note that standalone versions do not stay in sync with the Marketplace version so you will need to manually upgrade them in any reports. Unless you're wanting to adopt features early, it's recommended you stick with the Marketplace version.

You can get the [latest standalone version for download here](https://github.com/dm-p/powerbi-visuals-html-content/releases/latest).

Only the current marketplace version and the latest release version are supported, so if you wish to [create an issue](https://github.com/dm-p/powerbi-visuals-html-content/issues/new/choose), please check if you are on either of these, and consider switching across before you proceed.

## About the Visual

This visual is intended to be a spiritual successor to the HTML Viewer visual, which has recently been removed from the Power BI Marketplace.

There are some worked examples of how to approach this visual if you haven't used the previous one on the [Usage](./doc/usage.md) page.

## What's Different from the Original?

There are some additional features that the original doesn't have:

* You can use HTML generated from measures.
* You can opt to see the raw HTML rather than rendered HTML for debugging purposes.
* By default, hyperlinks wouldn't work due to custom visual limitations, but in this version you can opt to delegate URL requests to Power BI, which will provide the user with a prompt and request their approval. Please note that if in the Service, URLs will open in a new tab. This is how URLs need to work inside custom visuals.

Refer to the [Usage](./doc/usage.md) page for a guided example using these new features.

## Are there Still Limitations to What I Can Do with HTML in this Visual?

Yes.

A lot of the limitations that the original HTML Viewer visual had will still exist in this one; this is specifically to do with a number of restrictions imposed upon custom visual permissions by Power BI. 

While the visual will have a good go at rendering the HTML content you supply, it only only passes your content into the DOM on your behalf. Therefore, you will need to bear the following in mind:

* The browser(s) you are intending for your HTML content to be rendered in:
    * You will need to manage browser-specific behaviors if doing anything particularly complicated.
    * Note that Power BI Desktop is not a fully-functional web browser so may not render content in the same way as when reports are published to the Service.

* Restrictions imposed upon the visual by Power BI:
    * Custom visuals run in a [sandbox](https://www.w3schools.com/tags/att_iframe_sandbox.asp) with the least amount of privilege.
    * Any content hosted inside the visual that needs elevated privileges will likely not work correctly.
    * This sandboxing also removes the domain from any custom visuals, so they can't impersonate powerbi.com.
    * Therefore, accessing services or embedding content from sites that have <a href ="https://en.wikipedia.org/wiki/Cross-origin_resource_sharing" target="_blank">CORS</a> restrictions will not work inside the visual. 
    * These CORS restrictions are set by the target server and cannot be overridden from the client (our visual).

### Is there A Privacy Policy?

[Yes](./doc/privacy_policy.md).

### Is there A Roadmap?

Not a firm one. For the moment, my intention has been to provide something to fill the current gap left by the original visual for makers and end-users.

If there is an appetite for something specific - **that can be implemented within the current custom visual security constraints**  - feel free to [create an issue for it](https://github.com/dm-p/powerbi-visuals-html-content/issues/new/choose) and I'll see if I can accommodate.

This visual is developed in my free time and released free of charge, so if you're grateful for my community contributions, or want dedicated or specific support, please consider a [sponsorship tier](https://github.com/sponsors/dm-p) - you'll be helping to allow me to spend more time focusing on open source development. 

Thanks for stopping by!
