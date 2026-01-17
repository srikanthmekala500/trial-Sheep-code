import { getDatabase, ref, onValue, push, update, remove } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js";
import { escapeHTML, formatDate, showToast } from './utils.js';

let db;
let auth;
let storage;
let masterBlogPosts = [];
let blogPostModal;
let viewPostModal;
let quillEditor;
let currentPage = 1;
const POSTS_PER_PAGE = 6; // Display 6 posts per page
let htmlEditModal; // Variable to hold the HTML edit modal instance
let currentEditorView = 'compose'; // 'compose' or 'html'

export function initializeBlog(app, storageInstance, blogModalInstance, viewModalInstance) {
    db = getDatabase(app);
    auth = getAuth(app);
    storage = storageInstance;
    blogPostModal = blogModalInstance;
    viewPostModal = viewModalInstance;

    // Dynamically add the HTML Edit Modal to the body
    if (!document.getElementById('htmlEditModal')) {
        const modalHtml = `
            <div class="modal fade" id="htmlEditModal" tabindex="-1" aria-labelledby="htmlEditModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-xl">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="htmlEditModalLabel">Edit HTML Source</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <textarea id="htmlSourceEditor" class="form-control" rows="20"></textarea>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="saveHtmlSource">Apply HTML</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        htmlEditModal = new bootstrap.Modal(document.getElementById('htmlEditModal'));

        // Add listener for the "Apply HTML" button
        document.getElementById('saveHtmlSource').addEventListener('click', () => {
            const html = document.getElementById('htmlSourceEditor').value;
            quillEditor.root.innerHTML = html;
            htmlEditModal.hide();
        });
    }

    // Initialize the Quill editor
quillEditor = new Quill('#blogPostEditor', {
  theme: 'snow',
  modules: {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'link'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'align': [] }],
      [{ 'color': [] }, { 'background': [] }],
      ['blockquote', 'code-block'],
      [{ 'indent': '-1' }, { 'indent': '+1' }],
      [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
      ['image', 'clean'],
    ]
  }
});



    quillEditor.getModule('toolbar').addHandler('image', imageHandler);

    // Add event listeners specific to the blog
    document.getElementById('blogPostForm').addEventListener('submit', handleSaveBlogPost);
    const paginationContainer = document.getElementById('blogPagination');
    if (paginationContainer) paginationContainer.addEventListener('click', handlePaginationClick);

    // Add event listeners for the new toggle buttons
    document.getElementById('composeViewBtn')?.addEventListener('click', () => toggleEditorView('compose'));
    document.getElementById('htmlViewBtn')?.addEventListener('click', () => toggleEditorView('html'));
}


/**
 * Toggles between the Quill rich text editor and a raw HTML textarea.
 * @param {string} view - 'compose' for Quill, 'html' for raw HTML.
 */
function toggleEditorView(view) {
    const quillContainer = document.getElementById('quillEditorContainer');
    const htmlEditor = document.getElementById('blogPostHtmlEditor');
    const composeBtn = document.getElementById('composeViewBtn');
    const htmlBtn = document.getElementById('htmlViewBtn');

    if (!quillContainer || !htmlEditor || !composeBtn || !htmlBtn) {
        console.error("Editor toggle elements not found.");
        return;
    }

    if (view === 'html') {
        htmlEditor.value = quillEditor.root.innerHTML; // Get HTML from Quill
        quillContainer.style.display = 'none';
        htmlEditor.style.display = 'block';
        composeBtn.classList.remove('active', 'btn-primary');
        composeBtn.classList.add('btn-outline-primary');
        htmlBtn.classList.add('active', 'btn-primary');
        htmlBtn.classList.remove('btn-outline-primary');
    } else { // 'compose' view
        htmlEditor.style.display = 'none';
        quillContainer.style.display = 'block';
        htmlBtn.classList.remove('active', 'btn-primary');
        htmlBtn.classList.add('btn-outline-primary');
        composeBtn.classList.add('active', 'btn-primary');
        composeBtn.classList.remove('btn-outline-primary');
        quillEditor.root.innerHTML = htmlEditor.value; // Set HTML to Quill AFTER it's visible
    }
    currentEditorView = view;
}


/**
 * Sets the master list of blog posts for the module to use.
 * @param {Array} posts - An array of blog post objects.
 */
export function setBlogPosts(posts) {
    if (!posts) return;
    masterBlogPosts = posts;
}

/**
 * Returns a Bootstrap badge class based on the blog post category.
 * @param {string} category - The category of the blog post.
 * @returns {string} A Bootstrap background color class.
 */
function getCategoryBadgeClass(category) {
    switch (category) {
        case 'Daily Activity': return 'bg-primary';
        case 'Feed': return 'bg-success';
        case 'Medicine': return 'bg-info text-dark';
        case 'Disease & Symptoms': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

/**
 * Renders the blog section with all posts.
 */
export function renderBlogSection(posts = [], activeCategory = 'all') {
    // When a category filter is clicked, app.js calls this. We should reset the page.
    // A simple check: if the category is different from the one that was rendered, reset page.
    // This is a bit implicit. A better way would be for the caller to reset the page.
    // For now, we'll handle it in the event listener in app.js.

    // This function is now also triggered by search, so we need to get the current search term
    const container = document.getElementById('blogPostsContainer');
    const filterContainer = document.getElementById('blogCategoryFilters');
    const searchInput = document.getElementById('blogSearchInput');
    const paginationContainer = document.getElementById('blogPagination');
    if (!container || !filterContainer || !searchInput || !paginationContainer) return;

    const searchTerm = searchInput.value.toLowerCase();

    // --- 1. Render Category Filters ---
    const categories = ['all', ...new Set(posts.map(p => p.category).filter(Boolean))];

    const filterHtml = categories.map(category => {
        const isActive = category === activeCategory;
        return `
            <button 
                class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'} blog-category-filter me-2 mb-2" 
                data-category="${escapeHTML(category)}">
                ${category === 'all' ? 'All Posts' : escapeHTML(category)}
            </button>
        `;
    }).join('');
    filterContainer.innerHTML = `<span class="me-2 small text-muted">Filter by:</span>` + filterHtml;


    // --- 2. Filter and Render Posts ---
    let filteredPosts = [...posts];

    // Apply category/tag filter
    if (activeCategory === 'drafts') {
        // Special filter for viewing drafts
        filteredPosts = filteredPosts.filter(post => post.status === 'draft');
    } else if (activeCategory !== 'all') {
        filteredPosts = filteredPosts.filter(post => post.category === activeCategory);
    }

    // Apply search term filter
    if (searchTerm) {
        filteredPosts = filteredPosts.filter(post => {
            const titleMatch = post.title.toLowerCase().includes(searchTerm);
            const contentMatch = post.content.toLowerCase().includes(searchTerm);
            const tagMatch = post.tags ? post.tags.some(tag => tag.toLowerCase().includes(searchTerm)) : false;
            const categoryMatch = post.category ? post.category.toLowerCase().includes(searchTerm) : false;
            return titleMatch || contentMatch || tagMatch || categoryMatch;
        });
    }

    // Sort posts by date, newest first, before pagination
    filteredPosts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Prioritize featured posts by moving them to the front of the array
    filteredPosts.sort((a, b) => {
        if (a.isFeatured && !b.isFeatured) return -1;
        if (!a.isFeatured && b.isFeatured) return 1;
        return new Date(b.date) - new Date(a.date); // Fallback to date sort
    });

    // Exclude drafts from the public view unless the "Drafts" filter is selected
    if (activeCategory !== 'drafts') {
        filteredPosts = filteredPosts.filter(post => post.status !== 'draft');
    }

    // --- 3. Paginate Posts ---
    const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
    const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
    const endIndex = startIndex + POSTS_PER_PAGE;
    const postsToRender = filteredPosts.slice(startIndex, endIndex);

    if (postsToRender.length === 0) {
        const message = activeCategory === 'all'
            ? (searchTerm ? 'No posts match your search.' : 'No blog posts yet. Click "New Post" to get started!')
            : `No posts found for "${escapeHTML(activeCategory)}".`;
        container.innerHTML = `<div class="col-12 text-center"><p class="text-muted">${message}</p></div>`;
        paginationContainer.innerHTML = ''; // Clear pagination if no results
        return;
    }

    // --- 4. Render Post Cards ---
    const postsHtml = postsToRender.map(post => {
        const snippet = createExcerpt(post.content);
        const categoryBadgeClass = getCategoryBadgeClass(post.category);
        const firstImage = extractFirstImage(post.content);
        const draftIndicatorHtml = post.status === 'draft'
            ? `<div class="position-absolute top-0 start-0 m-2"><span class="badge bg-secondary"><i class="fas fa-pencil-alt me-1"></i>Draft</span></div>`
            : '';

        const coverImageHtml = firstImage
            ? `<div class="card-img-top-container"><img src="${escapeHTML(firstImage)}" class="card-img-top" alt="${escapeHTML(post.title)}"></div>`
            : `<div class="card-img-top-container d-flex align-items-center justify-content-center bg-light"><div class="text-center text-muted"><i class="fas fa-image fa-3x mb-2"></i><p>No Image</p></div></div>`;

        const featuredBannerHtml = post.isFeatured
            ? `<div class="position-absolute top-0 end-0 m-2"><span class="badge bg-warning text-dark"><i class="fas fa-star me-1"></i>Featured</span></div>`
            : '';


        
        const tagsHtml = (post.tags && post.tags.length > 0)
            ? `<div class="mt-auto pt-3">
                 ${post.tags.map(tag => `<span class="badge bg-secondary-subtle text-secondary-emphasis rounded-pill me-1 mb-1 tag-badge blog-category-filter" data-category="${escapeHTML(tag)}">${escapeHTML(tag)}</span>`).join('')}
               </div>`
            : '<div class="mt-auto"></div>'; // Placeholder to maintain layout

        return `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100 shadow-sm position-relative">
                    ${draftIndicatorHtml}
                    ${featuredBannerHtml}
                    ${coverImageHtml}
                    <div class="card-body d-flex flex-column">
                        <span class="badge ${categoryBadgeClass} mb-2 align-self-start">${escapeHTML(post.category || 'General')}</span>
                        <h5 class="card-title">${escapeHTML(post.title)}</h5>
                        <p class="card-text small text-muted">By ${escapeHTML(post.author || 'Admin')} on ${formatDate(post.date)}</p>
                        <p class="card-text excerpt">${escapeHTML(snippet)}</p>
                        ${tagsHtml}
                    </div>
                    <div class="card-footer bg-transparent">
                         <div class="d-flex justify-content-between align-items-center">
                            <button class="btn btn-primary btn-sm js-view-blog-post" data-post-id="${post.id}">Read More</button>
                            <div class="btn-group">
                                <button class="btn btn-sm btn-outline-secondary js-edit-blog-post" data-post-id="${post.id}" title="Edit Post"><i class="fas fa-edit"></i></button>
                                <button class="btn btn-sm btn-outline-danger js-delete-blog-post" data-post-id="${post.id}" data-post-title="${escapeHTML(post.title)}" title="Delete Post"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = postsHtml;

    // --- 5. Render Pagination Controls ---
    renderPaginationControls(totalPages, paginationContainer);
}

/**
 * Creates a short excerpt from the blog post content.
 * @param {string} content - The full HTML content of the post.
 * @param {number} length - The approximate length of the excerpt.
 * @returns {string} A plain text excerpt.
 */
function createExcerpt(content, length = 120) {
    if (!content) return '';
    // Strip HTML tags to get plain text
    const text = content.replace(/<[^>]+>/g, '');
    if (text.length <= length) {
        return text;
    }
    // Trim to the length and find the last space to avoid cutting words
    let trimmed = text.substring(0, length);
    trimmed = trimmed.substring(0, Math.min(trimmed.length, trimmed.lastIndexOf(' ')));
    return trimmed + '...';
}

/**
 * Extracts the 'src' of the first <img> tag from an HTML string.
 * @param {string} htmlContent - The HTML content of the blog post.
 * @returns {string|null} The image URL or null if no image is found.
 */
function extractFirstImage(htmlContent) {
    if (!htmlContent) return null;
    const match = htmlContent.match(/<img [^>]*src="([^"]+)"/);
    return match ? match[1] : null;
}

/**
 * Custom handler for the Quill image button.
 * Triggers a file input, uploads the selected image to Firebase Storage,
 * and inserts the image URL into the editor.
 */
function imageHandler() {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;

        // Show a loading placeholder
        const range = quillEditor.getSelection(true);
        quillEditor.insertText(range.index, '[Uploading image...]', 'user');

        try {
            // Create a unique filename
            const fileName = `blog-images/${Date.now()}-${file.name}`;
            const imageRef = storageRef(storage, fileName);

            // Upload the file
            const snapshot = await uploadBytes(imageRef, file);

            // Get the public URL
            const downloadURL = await getDownloadURL(snapshot.ref);

            // Remove the placeholder and insert the image
            quillEditor.deleteText(range.index, '[Uploading image...]'.length);
            quillEditor.insertEmbed(range.index, 'image', downloadURL);
            quillEditor.setSelection(range.index + 1);

        } catch (error) {
            console.error("Image upload failed:", error);
            quillEditor.deleteText(range.index, '[Uploading image...]'.length);
            alert('Image upload failed. Please try again. See console for details.');
        }
    };
}

/**
 * Renders the pagination controls.
 * @param {number} totalPages - The total number of pages.
 * @param {HTMLElement} container - The container element for the pagination.
 */
function renderPaginationControls(totalPages, container) {
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let paginationHtml = '';

    // Previous Button
    paginationHtml += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="Previous">
                <span aria-hidden="true">&laquo;</span>
            </a>
        </li>
    `;

    // Page Number Buttons
    for (let i = 1; i <= totalPages; i++) {
        paginationHtml += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `;
    }

    // Next Button
    paginationHtml += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="Next">
                <span aria-hidden="true">&raquo;</span>
            </a>
        </li>
    `;

    container.innerHTML = paginationHtml;
}

export function resetBlogPage() {
    currentPage = 1;
}

export function openBlogPostModal(postId = null) {
    const form = document.getElementById('blogPostForm');
    form.reset();
    document.getElementById('blogPostId').value = postId || '';

    if (postId) {
        document.getElementById('blogPostModalTitle').textContent = 'Edit Blog Post';
        const post = masterBlogPosts.find(p => p.id === postId);
        if (post) {
            document.getElementById('blogPostTitle').value = post.title;
            document.getElementById('blogPostCategory').value = post.category || '';
            document.getElementById('blogPostTags').value = post.tags ? post.tags.join(', ') : '';
            document.getElementById('blogPostIsFeatured').checked = post.isFeatured || false;
            quillEditor.root.innerHTML = post.content;
            document.getElementById('blogPostHtmlEditor').value = post.content; // Also set for HTML editor
            toggleEditorView('compose'); // Default to compose view when opening for edit
        }
    } else {
        document.getElementById('blogPostModalTitle').textContent = 'New Blog Post';
        document.getElementById('blogPostIsFeatured').checked = false;
        quillEditor.setText('');
        document.getElementById('blogPostHtmlEditor').value = ''; // Clear HTML editor
        toggleEditorView('compose'); // Default to compose view for new post
    }
    blogPostModal.show();
}

function handleSaveBlogPost(e) {
    e.preventDefault();
    const saveAction = e.submitter.value; // 'draft' or 'published'

    const postId = document.getElementById('blogPostId').value;
    const tagsInput = document.getElementById('blogPostTags').value;
    const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(Boolean) : [];
    const postData = {
        title: document.getElementById('blogPostTitle').value,
        category: document.getElementById('blogPostCategory').value,
        status: saveAction, // Set the status based on the button clicked
        tags: tags,
        isFeatured: document.getElementById('blogPostIsFeatured').checked,
        content: currentEditorView === 'html' ? document.getElementById('blogPostHtmlEditor').value : quillEditor.root.innerHTML, // Get content from active editor
        author: auth.currentUser?.displayName || 'Admin',
        date: new Date().toISOString().split('T')[0]
    };

    const promise = postId
        ? update(ref(db, `blogPosts/${postId}`), postData)
        : push(ref(db, 'blogPosts'), postData);

    promise.then(() => {
        blogPostModal.hide();
        showToast(postId ? 'Post Updated' : 'Post Saved', `Your blog post "${postData.title}" has been saved.`);
    }).catch(error => {
        alert('Error saving post: ' + error.message);
    });
}

export function viewBlogPost(postId) {
    const post = masterBlogPosts.find(p => p.id === postId);
    if (!post) return;

    const modalTitle = document.getElementById('viewPostTitle');
    const postMeta = document.getElementById('viewPostMeta');
    const postBody = document.getElementById('viewPostBody');
    const postImageContainer = document.getElementById('viewPostImageContainer');

    if (!modalTitle || !postMeta || !postBody || !postImageContainer) {
        alert("Could not display the blog post because a UI element is missing. Please check the console for details.");
        return;
    }

    const categoryBadgeClass = getCategoryBadgeClass(post.category);
    const tagsHtml = (post.tags && post.tags.length > 0)
        ? post.tags.map(tag => `<span class="badge bg-secondary-subtle text-secondary-emphasis rounded-pill me-2 tag-badge blog-category-filter" data-category="${escapeHTML(tag)}">${escapeHTML(tag)}</span>`).join('')
        : '';
    
    modalTitle.textContent = post.title;
    postMeta.innerHTML = `
        <span class="badge ${categoryBadgeClass} me-2">${escapeHTML(post.category || 'General')}</span> 
        <span class="text-muted">By</span> <strong>${escapeHTML(post.author)}</strong> 
        <span class="text-muted">on</span> <strong>${formatDate(post.date)}</strong>
        ${tagsHtml ? `<div class="mt-2 border-top pt-2">${tagsHtml}</div>` : ''}
    `;

    // Handle cover image
    const firstImage = extractFirstImage(post.content);
    let contentToRender = post.content;

    if (firstImage) {
        postImageContainer.innerHTML = `<img src="${escapeHTML(firstImage)}" class="img-fluid rounded mb-3" alt="Cover image for ${escapeHTML(post.title)}">`;
        // Remove the first image from the content to prevent it from showing twice.
        contentToRender = contentToRender.replace(/<img[^>]*>/, '');
    } else {
        postImageContainer.innerHTML = ''; // Clear it if no image
    }
    postBody.innerHTML = contentToRender; // Render the (potentially modified) HTML content

    viewPostModal.show();
}

export function deleteBlogPost(postId, postTitle) {
    if (confirm(`Are you sure you want to delete the post "${postTitle}"?`)) {
        remove(ref(db, `blogPosts/${postId}`)).then(() => {
            showToast('Post Deleted', `"${postTitle}" has been deleted.`, 'danger');
        }).catch(error => alert('Error deleting post: ' + error.message));
    }
}

/**
 * Handles clicks on the pagination controls.
 * @param {Event} e - The click event.
 */
function handlePaginationClick(e) {
    e.preventDefault();
    const link = e.target.closest('a.page-link');
    if (!link || link.parentElement.classList.contains('disabled')) return;

    const page = parseInt(link.dataset.page, 10);
    currentPage = page;
    // Re-render the blog section with the new page, using the currently active category from app.js
    window.renderCurrentBlogView(); // We'll expose a function from app.js to do this

}
