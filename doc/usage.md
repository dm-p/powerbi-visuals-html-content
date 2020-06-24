# Usage

---
[Home](../readme.md) | **Usage** | [Privacy Policy](./privacy_policy.md)

---
## Getting Started

To use the visual, you need to either create a column or measure in your data model that contains valid HTML. When this is added to the **HTML Content** field, the visual will attempt to render the supplied HTML in the current row context.

Let's work through this with an example. Consider the following data:

![html_sample_data.png](./assets/png/html_sample_data.png "Sample data, showing country, two-digit code and a total sales measure.")

The `[Country]` and `[Country Code]` columns are fields from our data model and `[$ Sales]` is a measure that calculates total sales for the current row context.

### Columns

Let's say we want to represent the country with its flag using the [Country Flags API](https://www.countryflags.io/). We can create a calculated column as follows:

```
Country Flag HTML = "<img src=""https://www.countryflags.io/" & Financials[Country Code] & "/flat/24.png"">"
```
 > Note that because HTML code can contain double-quotes, we escape them in DAX using `""`

We can now add this to the HTML Display visual's **HTML Content** data role and we'll see a flag for each value of `Financials[Country Code]`, e.g.:

![html_country_flag_column.png](./assets/png/html_country_flag_column.png "A HTML column that generates a flag from a remote API, rendered in our visual.")

### Measures

Now, we perhaps want to enrich this with the total sales for each country. To do this, we need the values of `[$ Sales]`

Similar to the above, we could create a measure to "narrate" this as follows:

```
<HTML> Sales Summary = "Total sales: <b>" & FORMAT([$ Sales], "$#,##0") & "</b>"
```

> Note that the measure doesn't have to have the `<HTML>` prefix. As it's good practice to try and prefix measure names  with units to denote what type of value they return, like a `$`, `#` etc. This is my preferred prefix to denote that the measure returns HTML output when inspecting it in the *Fields* list. 

Like before, we can add this to the visual's **HTML Content** data role and this will result in the following output:

![html_simple_measure.png](./assets/png/html_simple_measure.png "Using a measure to create another, HTML-based one.")

As the **HTML Content** field renders the output and our measure has no additional context, we just get the total. If we want to split our measure for the distinct `[Country  Code]`, we can add our column to the **Granularity** data role and this will create the necessary context in the visual, e.g.:

![html_simple_measure_with_context.png](./assets/png/html_simple_measure_with_context.png "Using the Granularity field to give a measure row context within the visual.")

Now, we could re-write the measure to be context-aware, e.g.:

```
<HTML> Sales Summary by Country = 
    VAR 
        Sales = FORMAT([$ Sales], "$#,##0")
    VAR
        Country = SELECTEDVALUE(Financials[Country Flag HTML])
    VAR
        Context = SWITCH(
            TRUE(),
            Country = "", "All:", 
            Country
        )
    RETURN
        Context & " <b>" & Sales & "</b>"
```

![html_measure_with_context_handling.gif](./assets/gif/html_measure_with_context_handling.gif "Observation of measure context-awareness when a column is added to the Granularity data role.")

## Value Separation

The visual will flow HTML produced for each value together, but you can set the **Value Separation Method** property in the **Content Formatting** menu to separate them with a horizontal rule or `<hr/>` element, e.g.:

![html_separation_horizonal_rule.png](./assets/png/html_separation_horizonal_rule.png "Separation of discrete values with a <hr/> (horizontal rule) element.")

The last value will not include the separator.

## Raw HTML

The **Show Raw HTML** property can be used to debug your generated HTML output, e.g.:

![html_raw_view.png](./assets/png/html_raw_view.png "Viewing raw generated HTML.")

Note that the **Value Separation Method** can also be used to bettwe distinguide generated HTML for each value.

## Handling Hyperlinks to External URLs

Let's say that we want to direct our user to a page about the country when they click on the flag, and we've added a `[Country Information URL]` column to our model. In HTML, we can turn our image into a hyperlink and this is quite straightforward in DAX, e.g.:

```
<HTML> Sales Summary by Country with Hyperlink = 
    VAR 
        Sales = FORMAT([$ Sales], "$#,##0")
    VAR
        CountryFlag = SELECTEDVALUE(Financials[Country Flag HTML])
    VAR
        CountryInformationURL = SELECTEDVALUE(Financials[Country Information URL])
    VAR
        CountryContent = SWITCH(
            TRUE(),
            CountryFlag = "", "All:", 
            CountryFlag
        )
    VAR
        Hyperlink = SWITCH(
            TRUE(),
            CountryContent <> "" && CountryInformationURL <> "",
                "<a href=""" & CountryInformationURL & """>" & CountryContent & "</a>",
            CountryContent
        )
    RETURN
        Hyperlink & " <b>" & Sales & "</b>"
```

This will render the same output as before, and the flag is clickable, but nothing happens 😖

The reason for this is that custom visuals are protected from opening hyperlinks or external URLs on behalf of the user, as this is potentially malicious behaviour if done without any visible effect. And even though our user is clicking on a link they believe is legitimate, if phishing has taught us anything, it's certainly possible to socially engineer unsuspecting people into following malicious links.

However, custom visuals can request that Power BI open a URL on their behalf. The visual has an **Allow Opening URLs** property, which if set to **On**, will delegate the request to open the hyperlink to Power BI. If permitted, this will prompt the user for confirmation, e.g.:

![html_hyperlink_delegation.png](./assets/png/html_hyperlink_delegation.png "Hyperlink URL delegation example.")

While this is the raw URL, the user should still exercise caution on navigating to unknown sources.

## Further Examples with Measures

We could then, for example mix in some SVG that scales according to measures in our current context. This will draw a rectangle under each entry with a width proportional to percentage of total sales:

```
<HTML> Sales Summary by Country with Hyperlink and Bars = 
    VAR Sales = FORMAT([$ Sales], "$#,##0")
    VAR AllSales = CALCULATE([$ Sales], ALL('Financials'))
    VAR SalesPercent = DIVIDE(Sales, AllSales)
    VAR MaxBarWidth = 1000
    VAR BarHeight = 16
    VAR BarColour = "#12239E"
    VAR CountryFlag = SELECTEDVALUE(Financials[Country Flag HTML])
    VAR CountryInformationURL = SELECTEDVALUE(Financials[Country Information URL])
    VAR CountryContent = SWITCH(
            TRUE(),
            CountryFlag = "", "All:", 
            CountryFlag
        )
    VAR Hyperlink = SWITCH(
            TRUE(),
            CountryContent <> "" && CountryInformationURL <> "",
                "<a href=""" & CountryInformationURL & """>" & CountryContent & "</a>",
            CountryContent
        )
    VAR Bar = "
            <svg style=""height: " & BarHeight & "px"">
                <rect width=""" 
                    & MaxBarWidth * SalesPercent 
                    & """ height =""" & BarHeight & """ & fill="""
                    & BarColour & """/>
            </svg>
        "
    RETURN
        Hyperlink & " <b>" & Sales & "</b><br/>" & Bar
```

![html_measure_data_bars.png](./assets/png/html_measure_data_bars.png "Adding SVG to our visual to show data bars.")

As you can see, we can start to construct some very rich output based on our data 😀


## Handling Advanced Use Cases

While the visual will have a good go at rendering the HTML content you supply, it only only passes your content into the DOM on your behalf. Therefore, you will need to bear the following in mind:

* The target destination you are intending your HTML to be displayed in:
    * You will need to manage browser-specific behaviors if doing anything particularly complicated.
    * Note that Power BI Desktop is not a fully-functional web browser so may exhibit different behaviours what your content might look like when published to the Service or Mobile Devices.

* Permissions imposed upon the visual by Power BI:
    * Custom visuals run in a [sandbox](https://www.w3schools.com/tags/att_iframe_sandbox.asp) with the least amount of privilege.
    * Any content hosted inside the visual that needs elevated privileges will likely not work correctly.
    * This sandboxing also removes the domain from any custom visuals, so they can't impersonate powerbi.com.
    * Therefore, accessing services or embedding content from sites that have <a href ="https://en.wikipedia.org/wiki/Cross-origin_resource_sharing" target="_blank">CORS</a> restrictions will not work inside the visual. These restrictions are set by the destination website
