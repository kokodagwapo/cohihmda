# Add Feature Prompt

## Required Information

Before implementing a new feature, the assistant MUST collect:

### 1. Feature Description
- **What is the feature?** (clear, concise description)
- **Why is it needed?** (business value, user need, etc.)
- **Who will use it?** (end users, admins, developers, etc.)

### 2. Requirements Capture
- **Functional requirements**: What must the feature do?
- **Non-functional requirements**: Performance, security, scalability needs
- **Edge cases**: What edge cases must be handled?
- **Error cases**: What errors might occur? How should they be handled?

### 3. Acceptance Criteria
- **Must have**: Features that are required for the feature to be considered complete
- **Should have**: Features that are important but not blocking
- **Nice to have**: Features that can be added later
- **Definition of done**: What does "complete" mean?

### 4. Explicit "What Will NOT Change"
- **What code will NOT be modified**: List files/modules that are off-limits
- **What behavior will NOT change**: List existing behaviors that must remain
- **What APIs will NOT change**: List APIs that must remain backward compatible
- **What data will NOT be migrated**: List data that should not be touched

### 5. Integration Points
- **What existing code will this integrate with?**
- **What APIs/services will this use?**
- **What databases/tables will this access?**
- **What external services will this call?**

### 6. Constraints
- **Timeline**: Is there a deadline?
- **Dependencies**: Can new dependencies be introduced?
- **Breaking changes**: Are breaking changes acceptable?
- **Performance**: Are there performance requirements?
- **Security**: Are there security requirements?

### 7. Testing Requirements
- **Unit tests**: What unit tests are needed?
- **Integration tests**: What integration tests are needed?
- **E2E tests**: Are end-to-end tests needed?
- **Manual testing**: What manual testing is needed?

## Assistant Behavior

### If Information is Missing
- **STOP** and ask for missing information
- Do NOT proceed with assumptions
- List what is needed clearly

### If Scope is Unclear
- Ask for clarification on:
  - What is in scope
  - What is out of scope
  - What is the minimum viable feature
- Suggest breaking into smaller features if scope is too large

### During Implementation
- Implement only what's in the requirements
- Do NOT add "nice to have" features unless explicitly requested
- Follow existing patterns in the codebase
- Add tests as you implement
- Document any assumptions or uncertainties

### After Implementation
- Verify all acceptance criteria are met
- Verify tests pass
- Verify nothing outside scope was changed
- Document the feature
- Provide usage examples if applicable

## Example Feature Request Format

```
Feature: Add user profile picture upload

Description:
- Users should be able to upload a profile picture
- Picture should be displayed in user profile and next to user name
- Maximum file size: 2MB
- Supported formats: JPEG, PNG, WebP

Why needed:
- Improve user experience and personalization

Who will use it:
- End users (authenticated users)

Functional requirements:
- Upload button in user profile page
- File validation (type, size)
- Image preview before upload
- Progress indicator during upload
- Error handling for failed uploads

Non-functional requirements:
- Upload should complete within 5 seconds for files < 2MB
- Images should be stored securely (not in public directory)
- Images should be optimized/resized on upload

Edge cases:
- User uploads file that's too large
- User uploads invalid file type
- Upload fails due to network error
- User cancels upload mid-way

Error cases:
- File too large → Show error message
- Invalid file type → Show error message
- Upload fails → Show error message, allow retry
- Network error → Show error message, allow retry

Acceptance criteria:
- [ ] User can select image file from device
- [ ] User can see preview of selected image
- [ ] User can upload image successfully
- [ ] Image appears in user profile after upload
- [ ] Error messages are shown for invalid uploads
- [ ] Upload progress is shown during upload

What will NOT change:
- User authentication flow
- User profile data structure (except adding picture URL)
- Existing API endpoints (new endpoint will be added)
- Database schema (except adding picture_url column)

Integration points:
- Frontend: src/pages/Profile.tsx
- Backend: server-src/routes/users.ts (new endpoint)
- Storage: AWS S3 or local file system
- Database: users table (add picture_url column)

Constraints:
- Timeline: 2 weeks
- Can introduce new dependencies (e.g., image processing library)
- No breaking changes
- Performance: Upload should not block UI

Testing requirements:
- Unit tests: File validation logic
- Integration tests: Upload endpoint
- Manual testing: Upload flow in browser
```


