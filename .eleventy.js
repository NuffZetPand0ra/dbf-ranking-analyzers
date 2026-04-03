const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsPlugin = require('@11ty/eleventy-plugin-handlebars');

module.exports = function (eleventyConfig) {
  const partialsDir = path.join(__dirname, 'views', 'partials');
  const handlebars = Handlebars.create();

  for (const entry of fs.readdirSync(partialsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.hbs')) {
      continue;
    }

    const partialName = path.basename(entry.name, '.hbs');
    const partialPath = path.join(partialsDir, entry.name);
    handlebars.registerPartial(partialName, fs.readFileSync(partialPath, 'utf8'));
  }

  eleventyConfig.addPlugin(handlebarsPlugin, {
    eleventyLibraryOverride: handlebars
  });
  eleventyConfig.addWatchTarget('./css');
  eleventyConfig.addWatchTarget('./js');

  eleventyConfig.addPassthroughCopy({ 'css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'js': 'js' });
  eleventyConfig.addPassthroughCopy({ '.well-known': '.well-known' });
  eleventyConfig.addPassthroughCopy('google*.html');
  eleventyConfig.addPassthroughCopy({ 'favicon.svg': 'favicon.svg' });
  eleventyConfig.addPassthroughCopy({ 'manifest.json': 'manifest.json' });
  eleventyConfig.addPassthroughCopy({ 'robots.txt': 'robots.txt' });
  eleventyConfig.addPassthroughCopy({ 'sample_html': 'sample_html' });
  eleventyConfig.addPassthroughCopy({ 'sitemap.xml': 'sitemap.xml' });

  return {
    dir: {
      input: 'views',
      layouts: 'layouts',
      includes: 'partials',
      output: '_site'
    },
    htmlTemplateEngine: 'hbs',
    markdownTemplateEngine: 'hbs',
    templateFormats: ['html', 'hbs']
  };
};